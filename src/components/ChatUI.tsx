'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { Send, Loader2, Bot, User } from 'lucide-react';

export interface Source {
  id: string;
  similarity: number;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
}

export function useRAGChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);

  const sendMessage = useCallback(async (question: string) => {
    // Add user message immediately
    setMessages(prev => [...prev, { role: 'user', content: question }]);
    setStreaming(true);

    // Create a placeholder for the assistant's streaming response
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Pass current history (excluding the new user question and empty placeholder)
        body: JSON.stringify({ question, chatHistory: messages }), 
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error('No reader available');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const lines = decoder.decode(value).split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          
          try {
            const data = JSON.parse(line.slice(6));
            
            setMessages(prev => {
              const newMsgs = [...prev];
              const lastMsg = newMsgs[newMsgs.length - 1];
              
              if (data.done) {
                // Stream finished, attach sources
                lastMsg.sources = data.sources;
                setStreaming(false);
              } else {
                // Append chunk
                lastMsg.content += data.text;
              }
              return newMsgs;
            });
          } catch (e) {
             console.error("Error parsing stream chunk:", e);
          }
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      setStreaming(false);
      setMessages(prev => {
        const newMsgs = [...prev];
        newMsgs[newMsgs.length - 1].content = 'Sorry, an error occurred while processing your request.';
        return newMsgs;
      });
    }
  }, [messages]);

  return { messages, sendMessage, streaming };
}

export function ChatUI() {
  const { messages, sendMessage, streaming } = useRAGChat();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || streaming) return;
    sendMessage(input.trim());
    setInput('');
  };

  return (
    <div className="flex flex-col h-[600px] border border-gray-200 rounded-xl bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 p-4 border-b border-gray-100 bg-gray-50/50">
        <Bot className="h-5 w-5 text-blue-600" />
        <h3 className="font-semibold text-sm text-gray-800">Enterprise RAG Assistant</h3>
        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium ml-auto">
          Online
        </span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/30">
        {messages.length === 0 && (
          <div className="text-center py-12 flex flex-col items-center">
            <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center mb-3">
              <Bot className="h-6 w-6 text-blue-600" />
            </div>
            <p className="text-sm text-gray-500 max-w-[250px]">
              Ask me anything! I search through the enterprise knowledge base to find answers.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
            {msg.role === 'assistant' && (
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-1">
                <Bot className="h-4 w-4 text-blue-600" />
              </div>
            )}
            
            <div className={`max-w-[80%] rounded-2xl px-5 py-3.5 shadow-sm ${
              msg.role === 'user'
                ? 'bg-blue-600 text-white rounded-tr-sm'
                : 'bg-white border border-gray-100 text-gray-800 rounded-tl-sm'
            }`}>
              {msg.role === 'assistant' ? (
                <div className="prose prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-gray-50 prose-pre:border prose-pre:border-gray-200">
                  {msg.content ? (
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  ) : (
                    <span className="inline-block w-2 h-4 bg-gray-300 animate-pulse"></span>
                  )}
                </div>
              ) : (
                <p className="text-sm font-medium">{msg.content}</p>
              )}

              {/* Source citations */}
              {msg.sources && msg.sources.length > 0 && (
                <div className="mt-4 pt-3 border-t border-gray-100 space-y-1.5">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Sources</p>
                  <div className="flex flex-col gap-1">
                    {msg.sources.map((s, j) => (
                      <div key={j} className="text-xs text-blue-600 flex items-center gap-1.5">
                        <span className="text-gray-400">📄</span> 
                        <span className="truncate max-w-[200px]">Doc ID: {s.id.substring(0,8)}...</span>
                        <span className="text-gray-400 ml-auto bg-gray-50 px-1.5 py-0.5 rounded">
                          {(s.similarity * 100).toFixed(0)}% match
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            {msg.role === 'user' && (
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0 mt-1">
                <User className="h-4 w-4 text-white" />
              </div>
            )}
          </div>
        ))}

        {streaming && messages[messages.length - 1]?.content === '' && (
          <div className="flex items-center gap-2 text-gray-400 ml-11">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-xs font-medium">Searching knowledge base...</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-100 bg-white">
        <div className="flex gap-2 relative">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder="Ask a question..."
            className="flex-1 text-black border border-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-full pl-5 pr-12 py-3 text-sm outline-none transition-all shadow-sm disabled:bg-gray-50 disabled:text-gray-400"
            disabled={streaming}
          />
          <button
            onClick={handleSend}
            disabled={streaming || !input.trim()}
            className="absolute right-1.5 top-1.5 bottom-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 text-white w-9 h-9 flex items-center justify-center rounded-full transition-colors"
          >
            <Send className="h-4 w-4 ml-0.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
