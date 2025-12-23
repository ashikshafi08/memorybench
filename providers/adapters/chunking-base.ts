/**
 * Base class for chunking providers.
 *
 * Provides common functionality for chunk-and-embed providers:
 * - Pluggable vector storage (defaults to in-memory)
 * - Cosine similarity search
 * - Embedding provider integration
 */

import type { ProviderConfig, PreparedData, SearchResult } from "../../core/config.ts";
import { LocalProvider } from "../base/local-provider.ts";
import type { SearchOptions } from "../base/types.ts";
import {
	createEmbeddingProviderFromYaml,
	type EmbeddingProvider,
	type EmbeddingStats,
} from "../embeddings/index.ts";
import {
	type VectorStore,
	type StoredChunk,
	InMemoryVectorStore,
} from "../storage/index.ts";

// Re-export StoredChunk for backward compatibility
export type { StoredChunk } from "../storage/index.ts";

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
 *
 * Vector storage is pluggable - use `config.local.vectorStore` to inject
 * a custom implementation (e.g., Pinecone, Weaviate, Mem0).
 */
export abstract class ChunkingProvider extends LocalProvider {
	protected embeddingProvider: EmbeddingProvider | null = null;
	protected vectorStore: VectorStore;

	constructor(config: ProviderConfig) {
		super(config);
		// Use injected vector store or default to in-memory
		const injectedStore = config.local?.vectorStore;
		if (injectedStore) {
			// Validate that the injected store implements VectorStore interface
			if (
				typeof injectedStore !== "object" ||
				typeof (injectedStore as VectorStore).add !== "function" ||
				typeof (injectedStore as VectorStore).search !== "function" ||
				typeof (injectedStore as VectorStore).clear !== "function"
			) {
				throw new Error(
					"Invalid vectorStore: must implement VectorStore interface " +
					"(add, search, clear methods required)"
				);
			}
			this.vectorStore = injectedStore as VectorStore;
		} else {
			this.vectorStore = new InMemoryVectorStore();
		}
	}

	protected override async doInitialize(): Promise<void> {
		// Create embedding provider from config
		this.embeddingProvider = createEmbeddingProviderFromYaml(
			this.config.local?.embedding,
		);
	}

	protected override async doCleanup(): Promise<void> {
		// InMemoryVectorStore has clearAll(), but interface doesn't require it
		if ("clearAll" in this.vectorStore && typeof this.vectorStore.clearAll === "function") {
			(this.vectorStore as InMemoryVectorStore).clearAll();
		}
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

		// Build stored chunks with embeddings
		const storedChunks: StoredChunk[] = [];
		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i]!;
			const embedding = embedResult.embeddings[i]!;

			storedChunks.push({
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
			});
		}

		// Add to vector store
		await this.vectorStore.add(runTag, storedChunks);
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

		// Embed the query
		const queryEmbedding = await this.embeddingProvider!.embed(query);

		// Search vector store
		const scored = await this.vectorStore.search(runTag, queryEmbedding.vector, {
			limit: options?.limit ?? 10,
			threshold: options?.threshold ?? 0,
		});

		// Convert to SearchResult format
		return scored.map(({ chunk, score }) => ({
			id: chunk.id,
			content: chunk.content,
			score,
			metadata: chunk.metadata,
		}));
	}

	/**
	 * Clear all data for a runTag.
	 */
	override async clear(runTag: string): Promise<void> {
		await this.vectorStore.clear(runTag);
	}

	/**
	 * Get embedding statistics for cost reporting.
	 */
	getEmbeddingStats(): EmbeddingStats | null {
		return this.embeddingProvider?.getStats() ?? null;
	}
}
