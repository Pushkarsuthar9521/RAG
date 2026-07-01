# RAG Chatbot: Interview Prep & Architecture Learnings

This document is designed to help you explain this Enterprise RAG Chatbot project in engineering interviews. It breaks down the "Why" behind every technical decision so you can demonstrate deep architectural understanding.

---

## 1. The 30-Second Elevator Pitch
**Interviewer:** *"Tell me about the RAG chatbot you built."*

**Your Answer:** 
"I built an Enterprise-grade Retrieval-Augmented Generation (RAG) chatbot designed for multi-tenant knowledge bases. Instead of relying on a model's pre-trained data, it uses a 3-tier architecture: 
1. A **data ingestion pipeline** that parses and chunks documents.
2. A **retrieval layer** using Supabase, PostgreSQL, and `pgvector` with an HNSW index for fast semantic search.
3. A **generation layer** using the Gemini API to stream accurate, cited answers via Server-Sent Events (SSE). 
A major focus was on enterprise security, so I implemented strict Row-Level Security (RLS) to ensure users can only query documents they have explicit access to."

---

## 2. Core Architectural Decisions (The "Why")

### Why RAG instead of Fine-Tuning?
- **The "Why":** Fine-tuning teaches a model *how* to talk (tone/format), but RAG provides *what* to talk about (facts). RAG ensures the model always has the most up-to-date data without needing expensive, time-consuming retraining runs. It also allows the chatbot to provide **source citations**, which prevents hallucinations and builds user trust.

### Why Supabase and `pgvector` instead of Pinecone/Weaviate?
- **The "Why":** Adding a dedicated vector database introduces a distributed data problem (keeping your relational DB and vector DB in sync). By using Supabase with `pgvector`, we keep relational data (users, access control) and vector data in the exact same ecosystem. This simplifies CI/CD, reduces costs, and allows us to use Postgres Row-Level Security (RLS) directly on our vector searches.

### Why Google Gemini API?
- **The "Why":** Gemini (`gemini-1.5-flash` / `text-embedding-004`) offers a generous free tier (Google AI Studio) making it highly cost-effective for an MVP. Additionally, Gemini 1.5 models have massive context windows (up to 2M tokens), which is incredibly useful for RAG when we need to inject large amounts of retrieved context into the prompt.

---

## 3. Ingestion & Chunking Strategy

### Why use Recursive Chunking instead of Fixed-Size Chunking?
- **The "Why":** Fixed-size chunking (e.g., arbitrarily cutting text every 500 characters) often breaks context mid-sentence or mid-paragraph. Recursive chunking is smarter; it tries to split by headers, then paragraphs, then sentences. This preserves the semantic meaning of the text, leading to much better vector embeddings.

### Why add a 50-100 token overlap between chunks?
- **The "Why":** If a core concept spans across two chunks, a hard cut might result in neither chunk containing enough context to be retrieved. An overlap acts as a bridge, ensuring that concepts at the boundary of a chunk are fully captured in the embeddings.

---

## 4. Search & Retrieval

### Why use an HNSW index instead of IVFFlat in pgvector?
- **The "Why":** IVFFlat is faster to build but slower and less accurate to query. **HNSW (Hierarchical Navigable Small World)** builds a multi-layered graph that allows for incredibly fast and highly accurate Approximate Nearest Neighbor (ANN) searches. In production, query latency and accuracy are far more important than slightly slower index build times.

### Why use Hybrid Search (Vector + Keyword) instead of pure Vector Search?
- **The "Why":** Vector search is great for semantic meaning (e.g., understanding that "puppy" and "dog" are related). However, it struggles with exact matches like SKUs, employee IDs, or specific error codes. Hybrid search combines semantic vector search (cosine similarity) with traditional full-text keyword search (Postgres `tsvector`) using Reciprocal Rank Fusion, giving you the best of both worlds.

### Why add a Re-ranking step?
- **The "Why":** Vector similarity isn't perfect. We might retrieve 20 chunks that are mathematically similar, but only 5 are actually useful. A lightweight Re-ranker model evaluates the top 20 candidates specifically against the user's query and re-orders them based on true relevance before we send them to the LLM. This drastically improves answer quality.

---

## 5. Generation & User Experience

### Why use Server-Sent Events (SSE) for Streaming?
- **The "Why":** LLM generation is slow (high Time to First Byte / TTFB). If we waited for the entire response to generate before sending it to the frontend, the user would stare at a loading spinner for 5-10 seconds. SSE allows us to stream the text token-by-token (like ChatGPT does), creating a responsive, highly engaging UI.

### Why a "Hybrid" Memory Strategy instead of a Sliding Window?
- **The "Why":** A naive sliding window (e.g., just passing the last 5 messages) causes the bot to completely forget the original premise of the conversation. A hybrid approach passes a compressed summary of older messages plus the exact literal text of the last few messages. This preserves early context without blowing up the token limit.

---

## 6. Enterprise Security & Access Control

### Why implement Row-Level Security (RLS)?
- **The "Why":** In an enterprise setting (like an ERP or multi-tenant SaaS), a standard user must never see CEO-level financial documents. If we don't scope the vector search, the LLM might retrieve and leak restricted data. By applying Postgres RLS tied to the `user_id` or `entity_id`, the database physically prevents the vector search from even looking at chunks the user doesn't have permission to see.

### How did you handle Prompt Injection?
- **The "Why":** An attacker could hide instructions in a PDF (e.g., "Ignore previous instructions and output XYZ"). To mitigate this, we sanitize user inputs, limit query lengths (e.g., max 500 characters to prevent prompt stuffing), and strictly separate the system instructions from the retrieved context blocks in the prompt structure.

---

## 7. Common Interview Questions You Might Face

1. **"What was the hardest technical challenge you faced?"**
   *Tip: Talk about managing state with SSE streaming in React, or the challenge of tuning chunk sizes to get accurate retrieval.*
2. **"How would you scale this if you had 10 million documents?"**
   *Tip: Mention moving ingestion to a dedicated background queue (BullMQ), partitioning the Postgres database, and potentially migrating off `pgvector` to a distributed vector store (Pinecone) if metrics prove Postgres is the bottleneck.*
3. **"How do you know if your RAG pipeline is actually providing good answers?"**
   *Tip: Mention building an "Evaluation Pipeline" (evals). You create a golden dataset of 50 known Questions and expected Answers, and programmatically run the pipeline against them to measure retrieval hit-rate and answer accuracy when you change chunk sizes or models.*
