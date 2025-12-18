-- Enable the vector extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Documents table to track source documents with run isolation
CREATE TABLE IF NOT EXISTS openrouter_documents (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    run_tag TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Chunks table for document chunks
CREATE TABLE IF NOT EXISTS openrouter_chunks (
    id SERIAL PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES openrouter_documents(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    embedding VECTOR(1536) NOT NULL,
    chunk_index INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_openrouter_docs_run_tag ON openrouter_documents(run_tag);
CREATE INDEX IF NOT EXISTS idx_openrouter_chunks_doc_id ON openrouter_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_openrouter_chunks_embedding ON openrouter_chunks USING ivfflat (embedding vector_cosine_ops);
