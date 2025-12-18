import { insertDocument, insertChunk } from "./db";
import { generateEmbeddings, chunkText } from "./embeddings";

/**
 * Add a document to the RAG system
 * @param content - Document content
 * @param runTag - Run tag for isolation
 * @returns Array of created chunks
 */
export async function addDocument(content: string, runTag: string) {
	// Insert document
	const document = await insertDocument(content, runTag);

	// Chunk the document
	const chunks = chunkText(content);

	// Generate embeddings for all chunks
	const embeddings = await generateEmbeddings(chunks);

	// Insert chunks with embeddings
	const createdChunks = await Promise.all(
		chunks.map((chunk, index) =>
			insertChunk(document.id, chunk, embeddings[index]!, index),
		),
	);

	return createdChunks;
}
