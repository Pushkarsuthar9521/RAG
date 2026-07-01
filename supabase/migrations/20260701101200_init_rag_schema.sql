-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Documents table
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID,
  title TEXT,
  source_type TEXT,
  storage_path TEXT,
  status TEXT,
  uploaded_by UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Chunks table
CREATE TABLE chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  entity_id UUID,
  content TEXT NOT NULL,
  embedding VECTOR(768),
  section TEXT,
  page_number INTEGER,
  token_count INTEGER,
  content_hash TEXT
);

-- HNSW index
CREATE INDEX ON chunks 
  USING hnsw (embedding vector_cosine_ops) 
  WITH (m = 16, ef_construction = 64);

-- Search Function
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

-- Chat conversations table
CREATE TABLE rag_conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  title       TEXT,            
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
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own conversations"
  ON rag_conversations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users see own messages"
  ON rag_messages FOR SELECT
  USING (conversation_id IN (
    SELECT id FROM rag_conversations WHERE user_id = auth.uid()
  ));
