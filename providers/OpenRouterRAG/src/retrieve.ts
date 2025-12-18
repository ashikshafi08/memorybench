import { findSimilarChunks } from "./db";
import { generateEmbeddings } from "./embeddings";

/**
 * Retrieve relevant chunks for a query
 * @param query - Search query
 * @param runTag - Run tag for isolation
 * @param limit - Maximum number of results
 * @returns Array of similar chunks with scores
 */
export async function retrieve(query: string, runTag: string, limit: number = 5) {
	// Generate embedding for the query
	const [queryEmbedding] = await generateEmbeddings([query]);

	if (!queryEmbedding) {
		throw new Error("Failed to generate query embedding");
	}

	// Find similar chunks
	const results = await findSimilarChunks(queryEmbedding, runTag, limit);

	return results;
}
