# Enterprise RAG Chatbot — Implementation Plan
**Stack fit:** Node.js, Next.js, **Supabase** (PostgreSQL, pgvector, Auth, Storage)

---

## 1. Architecture Overview & Rationale

**Why RAG instead of Fine-Tuning?**
- **Data Freshness:** Always up-to-date without retraining.
- **Transparency:** Grounded in real docs with source citations (reduces hallucination).
- **Cost & Simplicity:** Low cost compared to GPU hours for retraining; simpler pipeline.


```
┌─────────────┐    ┌──────────────┐    ┌─────────────────┐
│  Next.js UI │───▶│  API Layer   │───▶│  Orchestrator    │
│ (chat, docs)│    │ (Supabase    │    │  (retrieval +    │
└─────────────┘    │ Edge or Next │    │   LLM calls)     │
                    │ API routes)  │    └────────┬─────────┘
                    └──────────────┘             │
                                                  ▼
                    ┌──────────────┐    ┌─────────────────┐
                    │  Ingestion   │───▶│  Supabase DB     │
                    │  Pipeline    │    │  (pgvector /     │
                    │ (workers)    │    │  PostgreSQL)     │
                    └──────────────┘    └─────────────────┘
                          │
                          ▼
                    ┌──────────────┐
                    │  Supabase    │
                    │  Storage     │
                    └──────────────┘
```

**Key decision:** Use **Supabase (pgvector)**. It provides a managed PostgreSQL database with the `pgvector` extension pre-installed, along with built-in Auth, Edge Functions, and Storage. This avoids spinning up a separate vector database (Pinecone/Weaviate) and simplifies your infrastructure by keeping your relational data, embeddings, and object storage all in one unified ecosystem.

---

## 2. Core Components

### 2.1 Document Ingestion Pipeline
- **Sources:** file uploads (PDF, DOCX, XLSX, CSV), Confluence/SharePoint/Google Drive connectors, web crawlers (for scraping documentation/guides like jsden.com), internal DB tables (for structured enterprise data).
- **Steps:**
  1. Upload → Supabase Storage (raw storage)
  2. Text extraction (`pdf-parse`, `mammoth` for docx, `xlsx` lib for spreadsheets)
  3. Chunking (see 2.2)
  4. Embedding generation (batch calls)
  5. Store chunks + vectors + metadata in Postgres
  6. Index status tracked in a `documents` table (queued → processing → indexed → failed)
- Run as a **background worker** (Supabase Edge Functions triggered by webhooks or database triggers, or BullMQ/Redis) — never block the request thread on ingestion.


### 2.2 Chunking Strategy
- **Methods:** Use **recursive character/token chunking** (split by headers → paragraphs → sentences) for structured docs like markdown or policies. Avoid naive fixed-size chunking as it breaks context mid-sentence.
- **Sizing:** ~500–800 tokens per chunk with an explicit **overlap of 50-100 tokens** (~10–15%) to ensure no context is lost at chunk boundaries.
- **Semantic Chunking:** For highly critical ERP data, consider grouping by embedding similarity, though recursive is usually the best balance of cost/quality.
- **Enriched Metadata:** Every chunk needs rich metadata for filtering and frontend citations: `document_id`, `title`, `source` (URL/path), `page/section`, `chunkIndex` (position in doc), `category/course`, `entity_id` (multi-tenant), `created_at`, `access_level`.
- **Admin UI:** Build a simple chunk-viewer tool (e.g., in React) to visualize chunks and overlaps during development — crucial for debugging ingestion quality.

### 2.3 Embeddings
- Use **Google Gemini embeddings** (`text-embedding-004` which outputs 768 dimensions) via the official Node SDK to leverage the generous free tier. Ensure your `pgvector` column is explicitly set to `VECTOR(768)`.
- Cache embeddings by content hash so re-ingestion of unchanged docs doesn't re-embed.

### 2.4 Retrieval
- **Hybrid search**: vector similarity + keyword/full-text search (Postgres `tsvector`), combined via reciprocal rank fusion. Pure vector search alone underperforms on exact terms (SKUs, error codes, employee names).
- **Cosine Similarity**: For the vector search part, use pgvector's cosine distance operator (`<=>`). Example query: `SELECT id, 1 - (embedding <=> query_embedding) AS similarity FROM chunks ORDER BY similarity DESC LIMIT 10`.
- **Metadata filtering**: filter by tenant/entity_id, department, document type, access level *before* similarity search (critical for multi-tenant/ERP-style data — this maps directly to the `businessEntityId` discriminator pattern you already used).
- Re-rank top-k (20-30 candidates) down to top 5-8 using a lightweight re-ranker (Cohere rerank or Voyage rerank) before sending to the LLM — meaningfully improves answer quality.

### 2.5 Generation Layer
- Use **Google Gemini models** (`gemini-1.5-flash` or `gemini-1.5-pro`) for generation. These models provide a massive context window (up to 2M tokens) and are free within the Google AI Studio Pro tier limits.
- **Memory Strategy:** Use a **Hybrid context windowing** approach (a summary of old messages + the last N literal messages) rather than a simple sliding window, as this preserves early conversation context without blowing up token limits.
- Prompt structure: system prompt with citation instructions + retrieved chunks (with source tags) + formatted conversation history + user query.
- **Always require citations** in the response (map chunk IDs → source documents) — this is what makes enterprise users trust the tool.
- **Streaming UI:** Stream responses via **Server-Sent Events (SSE)**. Build a custom React hook (e.g., `useRAGChat`) that parses the `TextDecoder` stream, appending text chunks to the message content in real-time, and resolving citations when the stream finishes (`{ done: true, sources: [...] }`). This prevents UX blocking during generation.

### 2.6 Access Control (this is the part enterprises actually care about)
- Row-level security in Postgres tied to your existing auth/entity model.
- Every retrieval query scoped by `entity_id` / role — a user should never get chunks from documents they can't access, even indirectly through the LLM's answer.
- Audit log every query + which chunks were retrieved (compliance requirement in most enterprise deals).

### 2.7 Frontend & UX Best Practices
Building a trustworthy enterprise UI requires attention to detail:
- **Markdown Rendering:** Use `react-markdown` to properly format code blocks, lists, and bold text returned by the LLM.
- **Source Citations:** Always render clickable source citations (with similarity percentages if helpful) at the bottom of the assistant's message.
- **Auto-scroll:** Automatically scroll to the latest message as it streams in, but smartly disable auto-scrolling if the user manually scrolls up to read past context.
- **Typing Indicators:** Show a loading state or typing indicator during the initial TTFB (Time to First Byte) before the stream begins.
- **Input Management:** Disable the text input while streaming to prevent race conditions or confusing conversation history.
- **Empty States:** Provide suggested/starter questions for new conversations to guide the user.

### 2.8 Backend API & Security
At minimum, the backend requires three core routes (`POST /ingest`, `POST /search`, `POST /chat`). Security and validation are critical at this layer:
- **Rate Limiting:** Strongly rate-limit the `/chat` and `/search` endpoints (e.g., 20 requests/minute per user) to prevent LLM billing abuse.
- **Input Validation:** Reject user queries over a certain length (e.g., >500 characters) to avoid prompt stuffing.
- **Endpoint Authentication:** Use strict authentication middleware on the `/ingest` route so only authorized admins/crawlers can update the knowledge base.
- **Sanitization:** Sanitize the retrieved chunk content before injecting it into the LLM prompt to mitigate potential prompt injection attacks hiding in the source documents.

---

## 3. Suggested Node.js Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js (App Router) / React / Angular with Tailwind CSS | You already know it, styling with Tailwind is standard |
| API | Next.js API routes (Edge Functions for low latency) or separate Express/Fastify service | Fastify if you expect high throughput |
| Orchestration | Plain Google GenAI API calls | Start plain — less abstraction overhead, easier to debug |
| DB | Supabase (PostgreSQL + `pgvector` extension) | Perfect fit, built-in vector support |
| Queue | Supabase Edge Functions or BullMQ + Redis | Background tasks for ingestion |
| Storage | Supabase Storage | Replaces GCS/S3, natively integrates with Postgres RLS |
| Embeddings | Google Gemini Embeddings (`text-embedding-004`) | Generous free tier |
| Deployment | Vercel (Frontend) + Supabase (Backend/DB) | Drastically simplifies infrastructure vs Terraform/GCP |

---

## 4. Data Model (simplified)

```sql
documents (
  id, entity_id, title, source_type, storage_path,
  status, uploaded_by, created_at
)

chunks (
  id, document_id, entity_id, content, embedding vector(768),
  section, page_number, token_count, content_hash
)
```

**Crucial Database Additions (`pgvector`):**
1. **Index Type:** Always use **HNSW** (Hierarchical Navigable Small World) rather than IVFFlat. HNSW provides faster and more accurate queries which is critical for RAG in production, despite slightly slower build times.
```sql
-- Create an HNSW index for fast similarity search
CREATE INDEX ON chunks 
  USING hnsw (embedding vector_cosine_ops) 
  WITH (m = 16, ef_construction = 64);
```

2. **Search Function:** Use a Postgres function to keep the retrieval query clean on the Node side.
```sql
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding VECTOR(768),
  match_count INT DEFAULT 5,
  match_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (id UUID, document_id UUID, content TEXT, similarity FLOAT)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id, c.document_id, c.content,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM chunks c
  WHERE 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
```

```sql
-- Chat conversations table
CREATE TABLE rag_conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  title       TEXT,            -- Auto-generated from first message
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Chat messages table
CREATE TABLE rag_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES rag_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  sources         JSONB DEFAULT '[]',
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- RLS policies
ALTER TABLE rag_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own conversations"
  ON rag_conversations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users see own messages"
  ON rag_messages FOR SELECT
  USING (conversation_id IN (
    SELECT id FROM rag_conversations WHERE user_id = auth.uid()
  ));
```

---

## 5. Phased Roadmap

**Phase 1 — MVP (2-3 weeks)**
- Single-tenant, manual doc upload, basic chunking + pgvector search
- Simple chat UI in Next.js, non-streaming responses
- No re-ranking, no hybrid search yet

**Phase 2 — Quality & Multi-tenancy (3-4 weeks)**
- Multi-entity access control (reuse your `businessEntityId` pattern)
- Hybrid search + re-ranking
- Streaming responses, citation UI
- Ingestion queue (BullMQ), status tracking

**Phase 3 — Enterprise hardening (3-4 weeks)**
- Audit logging, rate limiting, RBAC
- Connectors (Confluence, SharePoint, Drive) if needed
- Evaluation pipeline (a golden Q&A set to catch retrieval regressions)
- Observability (latency, retrieval hit-rate, token cost dashboards)

**Phase 4 — Scale & polish**
- Caching layer for repeated queries
- Cost optimization (prompt caching via Claude's prompt caching feature, smaller models for simple queries)
- Load testing, move off pgvector only if metrics justify it

---

## 6. Things People Get Wrong (worth planning around early)

1. **No re-ranking** → mediocre answers even with good embeddings. Budget for it from Phase 2.
2. **Chunking too naively** → losing table/section context. Test chunking strategy against real enterprise docs early, not synthetic ones.
3. **No access control at retrieval time** → security issue, not just a UX one. Bake this into your schema from day 1, not retrofit later.
4. **No citations** → enterprise users won't trust or adopt it. Non-negotiable for this audience.
5. **No evaluation set** → you won't know when a change improves or degrades retrieval quality. Even 30-50 hand-written Q&A pairs against known docs goes a long way.

---

## 7. Next Steps
- Confirm document types/sources you need to support first (this changes ingestion complexity significantly)
- Decide: single-tenant pilot first, or multi-tenant from day 1 (affects schema design now)
- Pick embeddings + reranking provider and get API keys sorted
