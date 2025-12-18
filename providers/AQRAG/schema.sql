-- Enable the vector extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Documents table to track source documents
CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    run_tag TEXT
);

-- Index for run_tag filtering
CREATE INDEX IF NOT EXISTS idx_documents_run_tag ON documents(run_tag);

-- Chunks table for document chunks (without embeddings)
CREATE TABLE IF NOT EXISTS chunks (
    id SERIAL PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    content TEXT NOT NULL
);

-- Embeddings table to store both chunk and question embeddings
CREATE TABLE IF NOT EXISTS embeddings (
    id SERIAL PRIMARY KEY,
    chunk_id INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    embedding VECTOR(1536) NOT NULL,
    is_question_embedding BOOLEAN NOT NULL DEFAULT FALSE
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_chunk_id ON embeddings(chunk_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_is_question ON embeddings(is_question_embedding);
CREATE INDEX IF NOT EXISTS idx_embeddings_vector ON embeddings USING ivfflat (embedding vector_cosine_ops);
