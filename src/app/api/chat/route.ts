import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { ai } from '@/lib/gemini';

export async function POST(req: NextRequest) {
  try {
    const { question, chatHistory = [] } = await req.json();

    // 1. Embed the user's question
    const embeddingResponse = await ai.models.embedContent({
      model: 'gemini-embedding-2',
      contents: question,
      config: { outputDimensionality: 768 }
    });
    const embedding = embeddingResponse.embeddings?.[0]?.values;

    if (!embedding) {
      return NextResponse.json({ error: 'Failed to generate embedding' }, { status: 500 });
    }

    // 2. Retrieve relevant chunks using our match_documents function
    // Assuming auth is handled elsewhere, we pass a dummy user for now
    const { data: chunks, error: matchError } = await supabase.rpc('match_documents', {
      query_embedding: embedding,
      match_count: 5,
      match_threshold: 0.6
    });

    if (matchError) {
      console.error('Match error:', matchError);
      return NextResponse.json({ error: 'Failed to retrieve documents' }, { status: 500 });
    }

    // 3. Build the prompt with context
    const contextText = chunks?.map((c: any) => `Source Document ID: ${c.document_id}\nContent:\n${c.content}\n`).join('\n---\n') || 'No context found.';
    
    const systemPrompt = `You are an expert enterprise chatbot for JSDen.
Use the provided context to answer the user's question if it contains relevant information. 
If the provided context does not contain relevant information, answer the question using your own general knowledge as a helpful assistant.
If you do not know the answer at all, simply say "I'm sorry, but I don't know the answer to that." Do not mention the context or datasources in your apology.
If you use information from the provided context, ALWAYS cite your sources by mentioning the Source Document ID.

Context:
${contextText}`;

    const formattedHistory = chatHistory.map((msg: any) => 
      `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`
    ).join('\n');
    
    const finalPrompt = `${systemPrompt}\n\nChat History:\n${formattedHistory}\n\nUser: ${question}\nAssistant:`;

    // 4. Generate streaming response using Gemini
    const responseStream = await ai.models.generateContentStream({
      model: 'gemini-2.5-flash',
      contents: finalPrompt,
    });

    // 5. Create SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of responseStream) {
            if (chunk.text) {
              const data = JSON.stringify({ text: chunk.text, done: false });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }
          }
          
          // Send final completion message with sources
          const sources = chunks?.map((c: any) => ({
            id: c.document_id,
            similarity: c.similarity
          })) || [];
          
          const finalData = JSON.stringify({ text: '', done: true, sources });
          controller.enqueue(encoder.encode(`data: ${finalData}\n\n`));
          
        } catch (e) {
          console.error('Stream error:', e);
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
    
  } catch (error: any) {
    console.error('Chat API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
