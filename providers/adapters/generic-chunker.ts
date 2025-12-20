/**
 * Generic Chunking Provider
 *
 * Single provider class that dispatches to the appropriate chunker
 * based on config.name. This replaces 4 separate provider classes
 * (code-chunk-ast, code-chunk-fixed, chonkie-code, chonkie-recursive).
 *
 * The chunker is selected by looking up config.name in the chunker registry.
 * Configuration (size, overlap, etc.) comes from config.local.chunking.
 */

import type { ProviderConfig, PreparedData } from "../../core/config.ts";
import { ChunkingProvider, type ChunkResult as BaseChunkResult } from "./chunking-base.ts";
import {
	getChunker,
	getChunkerNames,
	type ChunkResult,
	type ChunkingConfig,
} from "./chunker-registry.ts";

/**
 * Generic chunking provider that dispatches to registered chunkers.
 *
 * Uses config.name to select which chunker to use from the registry.
 * All chunkers share the same embedding and storage logic from ChunkingProvider.
 */
export class GenericChunkerProvider extends ChunkingProvider {
	private readonly chunkerName: string;

	constructor(config: ProviderConfig) {
		super(config);
		// Use config.name to select chunker (NOT local.chunking.type)
		this.chunkerName = config.name;
	}

	/**
	 * Initialize the provider.
	 * Runs base initialization (embedding provider) plus chunker preflight check.
	 */
	protected override async doInitialize(): Promise<void> {
		// First, set up embedding provider via base class
		await super.doInitialize();

		// Validate that the chunker exists
		const chunker = getChunker(this.chunkerName);
		if (!chunker) {
			const available = getChunkerNames().join(", ");
			throw new Error(
				`Unknown chunker: ${this.chunkerName}. Available chunkers: ${available}`,
			);
		}

		// Run preflight check if defined (e.g., Chonkie Python deps)
		if (chunker.preflight) {
			await chunker.preflight();
		}
	}

	/**
	 * Sync chunking is not supported - all chunkers are async.
	 * This method is required by the base class but should not be called.
	 */
	protected chunkText(_content: string, _filepath: string): BaseChunkResult[] {
		throw new Error(
			"GenericChunkerProvider uses async chunking. Use addContext instead.",
		);
	}

	/**
	 * Add context by chunking and embedding.
	 * Overrides base class to use async chunker dispatch.
	 */
	override async addContext(data: PreparedData, runTag: string): Promise<void> {
		this.ensureInitialized();

		// Get the chunker (already validated in doInitialize)
		const chunker = getChunker(this.chunkerName)!;

		// Get chunking config from provider config
		const chunkConfig: ChunkingConfig = this.config.local?.chunking ?? {};

		// Get or create store for this runTag
		if (!this.stores.has(runTag)) {
			this.stores.set(runTag, []);
		}
		const store = this.stores.get(runTag)!;

		// Extract filepath from metadata
		const filepath = (data.metadata.filepath as string) || data.id;

		// Chunk the content using the registered chunker
		let chunks: ChunkResult[];
		try {
			chunks = await chunker.chunkFn(data.content, filepath, chunkConfig);
		} catch (error) {
			// Log warning but continue - some files may fail to parse
			console.warn(
				`Chunking failed for ${filepath} with ${this.chunkerName}: ${error}`,
			);
			return;
		}

		if (chunks.length === 0) {
			return;
		}

		// Embed all chunks in a batch
		const texts = chunks.map((c) => c.content);
		const embedResult = await this.embeddingProvider!.embedBatch(texts);

		// Store chunks with embeddings
		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i]!;
			const embedding = embedResult.embeddings[i]!;

			store.push({
				// Use custom ID if provided, otherwise fallback to index-based ID
				id: chunk.id ?? `${filepath}:${i}`,
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
	}
}

export default GenericChunkerProvider;
