import { ChatUI } from '@/components/ChatUI';

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4 sm:p-8 font-[family-name:var(--font-geist-sans)]">
      <div className="w-full max-w-4xl">
        <h1 className="text-2xl font-bold text-gray-800 mb-6 text-center">Enterprise RAG Chatbot</h1>
        <ChatUI />
      </div>
    </main>
  );
}
