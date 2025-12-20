/**
 * Base class for chunking providers.
 *
 * Provides common functionality for chunk-and-embed providers:
 * - In-memory vector storage per runTag
 * - Cosine similarity search
 * - Embedding provider integration
 */

import type { ProviderConfig, PreparedData, SearchResult } from "../../core/config.ts";
import { LocalProvider } from "../base/local-provider.ts";
import type { SearchOptions } from "../base/types.ts";
import {
	createEmbeddingProviderFromYaml,
	cosineSimilarity,
	type EmbeddingProvider,
	type EmbeddingStats,
} from "../embeddings/index.ts";

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
 * Result of chunking a file.
 */
export interface ChunkResult {
	/** Chunk text content */
	content: string;
	/** Start line (1-indexed) */
	startLine?: number;
	/** End line (1-indexed, inclusive) */
	endLine?: number;
}

/**
 * Abstract base class for chunk-and-embed providers.
 *
 * Subclasses must implement the `chunkText` method to define their chunking strategy.
 */
export abstract class ChunkingProvider extends LocalProvider {
	protected embeddingProvider: EmbeddingProvider | null = null;
	protected stores = new Map<string, StoredChunk[]>();

	constructor(config: ProviderConfig) {
		super(config);
	}

	protected override async doInitialize(): Promise<void> {
		// Create embedding provider from config
		this.embeddingProvider = createEmbeddingProviderFromYaml(
			this.config.local?.embedding,
		);
	}

	protected override async doCleanup(): Promise<void> {
		this.stores.clear();
	}

	/**
	 * Abstract method: chunk the text content.
	 * Subclasses must implement this to define their chunking strategy.
	 */
	protected abstract chunkText(
		content: string,
		filepath: string,
	): ChunkResult[];

	/**
	 * Add context by chunking and embedding.
	 */
	override async addContext(data: PreparedData, runTag: string): Promise<void> {
		this.ensureInitialized();

		// Get or create store for this runTag
		if (!this.stores.has(runTag)) {
			this.stores.set(runTag, []);
		}
		const store = this.stores.get(runTag)!;

		// Extract filepath from metadata
		const filepath = (data.metadata.filepath as string) || data.id;

		// Chunk the content
		const chunks = this.chunkText(data.content, filepath);

		if (chunks.length === 0) {
			return;
		}

		// Embed all chunks in a batch
		const texts = chunks.map((chunk) => chunk.content);
		const embedResult = await this.embeddingProvider!.embedBatch(texts);

		// Store chunks with embeddings
		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i]!;
			const embedding = embedResult.embeddings[i]!;

			const storedChunk: StoredChunk = {
				id: `${filepath}:${i}`,
				content: chunk.content,
				embedding: embedding.vector,
				metadata: {
					filepath,
					startLine: chunk.startLine,
					endLine: chunk.endLine,
					chunkIndex: i,
					...data.metadata,
				},
			};

			store.push(storedChunk);
		}
	}

	/**
	 * Search for relevant chunks using cosine similarity.
	 */
	override async searchQuery(
		query: string,
		runTag: string,
		options?: SearchOptions,
	): Promise<SearchResult[]> {
		this.ensureInitialized();

		const store = this.stores.get(runTag);
		if (!store || store.length === 0) {
			return [];
		}

		const limit = options?.limit ?? 10;
		const threshold = options?.threshold ?? 0;

		// Embed the query
		const queryEmbedding = await this.embeddingProvider!.embed(query);

		// Calculate similarities for all chunks
		const scored = store.map((chunk) => ({
			chunk,
			score: cosineSimilarity(queryEmbedding.vector, chunk.embedding),
		}));

		// Sort by score descending and filter by threshold
		scored.sort((a, b) => b.score - a.score);

		const results: SearchResult[] = [];
		for (const { chunk, score } of scored) {
			if (results.length >= limit) break;
			if (score < threshold) continue;

			results.push({
				id: chunk.id,
				content: chunk.content,
				score,
				metadata: chunk.metadata,
			});
		}

		return results;
	}

	/**
	 * Clear all data for a runTag.
	 */
	override async clear(runTag: string): Promise<void> {
		this.stores.delete(runTag);
	}

	/**
	 * Get embedding statistics for cost reporting.
	 */
	getEmbeddingStats(): EmbeddingStats | null {
		return this.embeddingProvider?.getStats() ?? null;
	}
}
