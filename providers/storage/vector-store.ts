/**
 * VectorStore Interface
 *
 * Abstract interface for vector storage backends.
 * Implementations can use in-memory storage, SQLite, Pinecone, Weaviate, etc.
 *
 * @example
 * ```typescript
 * // Custom implementation
 * class PineconeVectorStore implements VectorStore {
 *   async add(runTag: string, chunks: StoredChunk[]): Promise<void> {
 *     // Upsert vectors to Pinecone
 *   }
 *   async search(...): Promise<ScoredChunk[]> {
 *     // Query Pinecone
 *   }
 *   async clear(runTag: string): Promise<void> {
 *     // Delete vectors from Pinecone
 *   }
 * }
 * ```
 */

/**
 * A chunk with its metadata and embedding.
 */
export interface StoredChunk {
	/** Unique chunk ID (e.g., filepath:chunkIndex) */
	id: string;
	/** Chunk text content */
	content: string;
	/** Embedding vector */
	embedding: number[];
	/** Chunk metadata */
	metadata: {
		filepath: string;
		startLine?: number;
		endLine?: number;
		chunkIndex: number;
		[key: string]: unknown;
	};
}

/**
 * Options for vector search.
 */
export interface SearchOptions {
	/** Maximum number of results to return */
	limit?: number;
	/** Minimum similarity score threshold */
	threshold?: number;
}

/**
 * A chunk with its similarity score.
 */
export interface ScoredChunk {
	chunk: StoredChunk;
	score: number;
}

/**
 * Interface for vector storage backends.
 *
 * Implementations store and retrieve chunk embeddings for similarity search.
 * Each runTag represents an isolated namespace (e.g., per-benchmark-item).
 */
export interface VectorStore {
	/**
	 * Store chunks for a run tag.
	 *
	 * @param runTag - Namespace identifier (e.g., "benchmark-item-123")
	 * @param chunks - Array of chunks to store
	 */
	add(runTag: string, chunks: StoredChunk[]): Promise<void>;

	/**
	 * Search for similar chunks using cosine similarity.
	 *
	 * @param runTag - Namespace to search in
	 * @param queryVector - Query embedding vector
	 * @param options - Search options (limit, threshold)
	 * @returns Array of scored chunks, sorted by similarity descending
	 */
	search(runTag: string, queryVector: number[], options?: SearchOptions): Promise<ScoredChunk[]>;

	/**
	 * Clear all chunks for a run tag.
	 *
	 * @param runTag - Namespace to clear
	 */
	clear(runTag: string): Promise<void>;

	/**
	 * Get all stored chunks for a run tag (optional, for debugging).
	 *
	 * @param runTag - Namespace to retrieve from
	 * @returns Array of all stored chunks
	 */
	getAll?(runTag: string): Promise<StoredChunk[]>;

	/**
	 * Get the total number of chunks stored for a run tag (optional).
	 *
	 * @param runTag - Namespace to count
	 * @returns Number of chunks stored
	 */
	count?(runTag: string): Promise<number>;
}
