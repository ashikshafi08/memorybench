/**
 * In-Memory VectorStore Implementation
 *
 * Default vector storage using JavaScript Map.
 * Suitable for development, testing, and small-scale use.
 * For production with large datasets, consider using a dedicated vector database.
 */

import type { VectorStore, StoredChunk, SearchOptions, ScoredChunk } from "./vector-store.ts";
import { cosineSimilarity } from "../embeddings/index.ts";

/**
 * In-memory vector store implementation.
 *
 * Uses a Map to store chunks per runTag namespace.
 * Performs brute-force cosine similarity search.
 */
export class InMemoryVectorStore implements VectorStore {
	private stores = new Map<string, StoredChunk[]>();

	/**
	 * Store chunks for a run tag.
	 */
	async add(runTag: string, chunks: StoredChunk[]): Promise<void> {
		const existing = this.stores.get(runTag) || [];
		this.stores.set(runTag, [...existing, ...chunks]);
	}

	/**
	 * Search for similar chunks using cosine similarity.
	 */
	async search(
		runTag: string,
		queryVector: number[],
		options?: SearchOptions,
	): Promise<ScoredChunk[]> {
		const store = this.stores.get(runTag);
		if (!store || store.length === 0) {
			return [];
		}

		const limit = options?.limit ?? 10;
		const threshold = options?.threshold ?? 0;

		// Calculate similarity scores for all chunks
		const scored: ScoredChunk[] = store.map((chunk) => ({
			chunk,
			score: cosineSimilarity(queryVector, chunk.embedding),
		}));

		// Sort by score descending, filter by threshold, limit results
		return scored
			.sort((a, b) => b.score - a.score)
			.filter((s) => s.score >= threshold)
			.slice(0, limit);
	}

	/**
	 * Clear all chunks for a run tag.
	 */
	async clear(runTag: string): Promise<void> {
		this.stores.delete(runTag);
	}

	/**
	 * Get all stored chunks for a run tag.
	 */
	async getAll(runTag: string): Promise<StoredChunk[]> {
		return this.stores.get(runTag) || [];
	}

	/**
	 * Get the total number of chunks stored for a run tag.
	 */
	async count(runTag: string): Promise<number> {
		return this.stores.get(runTag)?.length ?? 0;
	}

	/**
	 * Clear all stores (for testing).
	 */
	clearAll(): void {
		this.stores.clear();
	}
}
