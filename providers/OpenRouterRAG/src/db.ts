import { sql } from "bun";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Get the directory of this module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface Document {
	id: number;
	content: string;
	run_tag: string;
}

export interface Chunk {
	id: number;
	document_id: number;
	content: string;
	chunk_index: number;
}

export interface SearchResult {
	id: number;
	content: string;
	similarity_score: number;
}

// Initialize database by creating tables
export async function initDatabase() {
	try {
		// Read and execute schema - path relative to this module
		const schemaPath = join(__dirname, "../schema.sql");
		const schemaFile = Bun.file(schemaPath);
		const schema = await schemaFile.text();

		// Split by statements and execute each one
		const statements = schema
			.split(";")
			.map((s) => s.trim())
			.filter((s) => s.length > 0);

		for (const statement of statements) {
			await sql.unsafe(statement);
		}

		console.log("OpenRouterRAG database initialized successfully");
	} catch (error) {
		console.error("Failed to initialize OpenRouterRAG database:", error);
		throw error;
	}
}

// Document operations
export async function insertDocument(content: string, runTag: string): Promise<Document> {
	const [document] = await sql`
    INSERT INTO openrouter_documents (content, run_tag)
    VALUES (${content}, ${runTag})
    RETURNING *
  `;
	return document;
}

// Chunk operations
export async function insertChunk(
	documentId: number,
	content: string,
	embedding: number[],
	chunkIndex: number,
): Promise<Chunk> {
	const [chunk] = await sql`
    INSERT INTO openrouter_chunks (document_id, content, embedding, chunk_index)
    VALUES (${documentId}, ${content}, ${JSON.stringify(embedding)}::vector, ${chunkIndex})
    RETURNING id, document_id, content, chunk_index
  `;
	return chunk;
}

// Search for similar chunks
export async function findSimilarChunks(
	embedding: number[],
	runTag: string,
	limit: number = 5,
): Promise<SearchResult[]> {
	const results = await sql`
    SELECT
      c.id,
      c.content,
      1 - (c.embedding <-> ${JSON.stringify(embedding)}::vector) as similarity_score
    FROM openrouter_chunks c
    JOIN openrouter_documents d ON c.document_id = d.id
    WHERE d.run_tag = ${runTag}
    ORDER BY c.embedding <-> ${JSON.stringify(embedding)}::vector
    LIMIT ${limit}
  `;
	return results;
}

// Delete all documents for a specific run tag
export async function deleteDocumentsByRunTag(runTag: string): Promise<void> {
	await sql`
    DELETE FROM openrouter_documents WHERE run_tag = ${runTag}
  `;
}

export { sql };
