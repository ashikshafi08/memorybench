import { sql } from "bun";
import type { Chunk, Document, WeightedSearchResult } from "./types";

// Initialize database by creating tables
export async function initDatabase() {
	try {
		// Read and execute schema
		const schemaFile = Bun.file("./schema.sql");
		const schema = await schemaFile.text();

		// Split by statements and execute each one
		const statements = schema
			.split(";")
			.map((s) => s.trim())
			.filter((s) => s.length > 0);

		for (const statement of statements) {
			await sql.unsafe(statement);
		}

		console.log("Database initialized successfully");
	} catch (error) {
		console.error("Failed to initialize database:", error);
		throw error;
	}
}

// Document operations
export async function insertDocument(content: string, runTag?: string): Promise<Document> {
	const [document] = await sql`
    INSERT INTO documents (content, run_tag)
    VALUES (${content}, ${runTag ?? null})
    RETURNING *
  `;
	return document;
}

export async function getDocument(id: number) {
	const [document] = await sql`
    SELECT * FROM documents WHERE id = ${id}
  `;
	return document;
}

export async function getAllDocuments() {
	return await sql`
    SELECT * FROM documents ORDER BY id DESC
  `;
}

// Chunk operations
export async function insertChunk(
	documentId: number,
	content: string,
	chunkEmbedding: number[],
	anticipatoryQuestionEmbeddings: number[],
): Promise<Chunk> {
	// First insert the chunk
	const [chunk] = await sql`
    INSERT INTO chunks (document_id, content)
    VALUES (${documentId}, ${content})
    RETURNING *
  `;

	// Then insert both embeddings
	await sql`
    INSERT INTO embeddings (chunk_id, embedding, is_question_embedding)
    VALUES
      (${chunk.id}, ${JSON.stringify(chunkEmbedding)}::vector, false),
      (${chunk.id}, ${JSON.stringify(anticipatoryQuestionEmbeddings)}::vector, true)
  `;

	return chunk;
}

export async function getAllChunks() {
	return await sql`
    SELECT c.*,
           e_chunk.embedding as chunk_embedding,
           e_question.embedding as question_embedding
    FROM chunks c
    LEFT JOIN embeddings e_chunk ON c.id = e_chunk.chunk_id AND e_chunk.is_question_embedding = false
    LEFT JOIN embeddings e_question ON c.id = e_question.chunk_id AND e_question.is_question_embedding = true
    ORDER BY c.id
  `;
}

// Weighted search function for research
export async function findSimilarWeighted(
	embedding: number[],
	// if questionWeight is 1, only search chunks
	// if questionWeight is 0, only search questions
	questionWeight: number = 1.0,
	limit: number,
	runTag?: string,
): Promise<WeightedSearchResult[]> {
	const chunkWeight = 1 - questionWeight;
	// Ensure chunkWeight is between 0 and 1
	const clampedWeight = Math.max(0, Math.min(1, chunkWeight));

	// If runTag is provided, filter by it
	if (runTag) {
		return await sql`
      WITH chunk_similarities AS (
        SELECT
          c.id,
          c.content,
          e.embedding <-> ${JSON.stringify(embedding)}::vector as chunk_distance,
          ${clampedWeight} as chunk_weight
        FROM chunks c
        JOIN documents d ON c.document_id = d.id
        JOIN embeddings e ON c.id = e.chunk_id AND e.is_question_embedding = false
        WHERE d.run_tag = ${runTag}
      ),
      question_similarities AS (
        SELECT
          c.id,
          e.embedding <-> ${JSON.stringify(embedding)}::vector as question_distance,
          ${questionWeight} as question_weight
        FROM chunks c
        JOIN documents d ON c.document_id = d.id
        JOIN embeddings e ON c.id = e.chunk_id AND e.is_question_embedding = true
        WHERE d.run_tag = ${runTag}
      )
      SELECT
        cs.*,
        qs.question_distance,
        (cs.chunk_distance * cs.chunk_weight + qs.question_distance * qs.question_weight) as weighted_distance,
        (1 - (cs.chunk_distance * cs.chunk_weight + qs.question_distance * qs.question_weight)) as similarity_score
      FROM chunk_similarities cs
      JOIN question_similarities qs ON cs.id = qs.id
      ORDER BY weighted_distance ASC
      LIMIT ${limit}
    `;
	}

	return await sql`
    WITH chunk_similarities AS (
      SELECT
        c.id,
        c.content,
        e.embedding <-> ${JSON.stringify(embedding)}::vector as chunk_distance,
        ${clampedWeight} as chunk_weight
      FROM chunks c
      JOIN embeddings e ON c.id = e.chunk_id AND e.is_question_embedding = false
    ),
    question_similarities AS (
      SELECT
        c.id,
        e.embedding <-> ${JSON.stringify(embedding)}::vector as question_distance,
        ${questionWeight} as question_weight
      FROM chunks c
      JOIN embeddings e ON c.id = e.chunk_id AND e.is_question_embedding = true
    )
    SELECT
      cs.*,
      qs.question_distance,
      (cs.chunk_distance * cs.chunk_weight + qs.question_distance * qs.question_weight) as weighted_distance,
      (1 - (cs.chunk_distance * cs.chunk_weight + qs.question_distance * qs.question_weight)) as similarity_score
    FROM chunk_similarities cs
    JOIN question_similarities qs ON cs.id = qs.id
    ORDER BY weighted_distance ASC
    LIMIT ${limit}
  `;
}

// Delete all documents and related data for a specific run tag
export async function deleteDocumentsByRunTag(runTag: string): Promise<void> {
	// Delete embeddings for chunks that belong to documents with this run_tag
	await sql`
    DELETE FROM embeddings
    WHERE chunk_id IN (
      SELECT c.id FROM chunks c
      JOIN documents d ON c.document_id = d.id
      WHERE d.run_tag = ${runTag}
    )
  `;

	// Delete chunks for documents with this run_tag
	await sql`
    DELETE FROM chunks
    WHERE document_id IN (
      SELECT id FROM documents WHERE run_tag = ${runTag}
    )
  `;

	// Delete documents with this run_tag
	await sql`
    DELETE FROM documents WHERE run_tag = ${runTag}
  `;
}

export { sql };
