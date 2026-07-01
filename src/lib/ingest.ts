import { supabase } from './supabase';
import { ai } from './gemini';

const MAX_CHUNK_LENGTH = 1000;
const OVERLAP_LENGTH = 200;

/**
 * Splits text into overlapping chunks recursively
 */
export function recursiveChunker(text: string): string[] {
  // Simple heuristic-based chunking for demonstration
  // In production, use LangChain's RecursiveCharacterTextSplitter
  const chunks: string[] = [];
  let startIndex = 0;
  
  while (startIndex < text.length) {
    let endIndex = startIndex + MAX_CHUNK_LENGTH;
    
    if (endIndex < text.length) {
      // Try to find a good breaking point (newline or period)
      const newlineIndex = text.lastIndexOf('\n', endIndex);
      const periodIndex = text.lastIndexOf('.', endIndex);
      
      if (newlineIndex > startIndex + OVERLAP_LENGTH) {
        endIndex = newlineIndex + 1;
      } else if (periodIndex > startIndex + OVERLAP_LENGTH) {
        endIndex = periodIndex + 1;
      }
    }
    
    chunks.push(text.slice(startIndex, endIndex).trim());
    startIndex = endIndex - OVERLAP_LENGTH;
    
    // Safety check to prevent infinite loops if overlap is too large
    if (startIndex < 0 || endIndex - startIndex <= OVERLAP_LENGTH) {
       startIndex = endIndex; 
    }
  }
  
  return chunks.filter(c => c.length > 0);
}

export async function ingestDocument(entityId: string, title: string, content: string) {
  // 1. Create document record
  const { data: doc, error: docError } = await supabase
    .from('documents')
    .insert({
      entity_id: entityId,
      title,
      status: 'processing'
    })
    .select()
    .single();

  if (docError) throw new Error(`Failed to create doc: ${docError.message}`);
  
  // 2. Chunk text
  const chunks = recursiveChunker(content);
  console.log(`Generated ${chunks.length} chunks for document: ${title}`);
  
  // 3. Generate embeddings & insert chunks
  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i];
    
    // Call Gemini for embedding
    const embeddingResponse = await ai.models.embedContent({
      model: 'gemini-embedding-2',
      contents: chunkText,
      config: { outputDimensionality: 768 }
    });
    
    const embedding = embeddingResponse.embeddings?.[0]?.values;
    if (!embedding) continue;
    
    // Save to DB
    const { error: chunkError } = await supabase
      .from('chunks')
      .insert({
        document_id: doc.id,
        entity_id: entityId,
        content: chunkText,
        embedding,
        section: title, // Optional, could parse headers
        page_number: i + 1,
        token_count: Math.round(chunkText.length / 4) // rough estimate
      });
      
    if (chunkError) {
      console.error(`Error saving chunk ${i}:`, chunkError);
    }
  }
  
  // 4. Update document status
  await supabase
    .from('documents')
    .update({ status: 'indexed' })
    .eq('id', doc.id);
    
  return doc.id;
}
