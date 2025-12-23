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

/**
 * Represents a single chunking failure for tracking and reporting.
 */
export interface ChunkingFailure {
	filepath: string;
	error: string;
	timestamp: string;
}

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
	/** Tracks chunking failures per runTag for reporting */
	private readonly failureStats = new Map<string, ChunkingFailure[]>();

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

		// Extract filepath from metadata
		const filepath = (data.metadata.filepath as string) || data.id;

		// Chunk the content using the registered chunker
		let chunks: ChunkResult[];
		try {
			chunks = await chunker.chunkFn(data.content, filepath, chunkConfig);
		} catch (error) {
			// Track failure for reporting
			this.trackFailure(runTag, filepath, String(error));

			console.warn(
				`Chunking failed for ${filepath} with ${this.chunkerName}: ${error}`,
			);

			// Propagate error to checkpoint system instead of silent return
			throw new Error(`Chunking failed for ${filepath}: ${error}`);
		}

		if (chunks.length === 0) {
			// Track empty results as failures
			this.trackFailure(runTag, filepath, "Chunker returned 0 chunks");

			throw new Error(`No chunks produced for ${filepath}`);
		}

		// Embed all chunks in a batch
		const texts = chunks.map((c) => c.content);
		const embedResult = await this.embeddingProvider!.embedBatch(texts);

		// Create StoredChunk objects with embeddings
		const storedChunks = chunks.map((chunk, i) => ({
			// Use custom ID if provided, otherwise fallback to index-based ID
			id: chunk.id ?? `${filepath}:${i}`,
			content: chunk.content,
			embedding: embedResult.embeddings[i]!.vector,
			metadata: {
				filepath,
				startLine: chunk.startLine,
				endLine: chunk.endLine,
				chunkIndex: i,
				...data.metadata,
			},
		}));

		// Add all chunks to vector store
		await this.vectorStore.add(runTag, storedChunks);
	}

	/**
	 * Track a chunking failure for later reporting.
	 */
	private trackFailure(runTag: string, filepath: string, error: string): void {
		if (!this.failureStats.has(runTag)) {
			this.failureStats.set(runTag, []);
		}
		this.failureStats.get(runTag)!.push({
			filepath,
			error,
			timestamp: new Date().toISOString(),
		});
	}

	/**
	 * Get chunking failures for a specific run.
	 */
	getChunkingFailures(runTag: string): ChunkingFailure[] {
		return this.failureStats.get(runTag) ?? [];
	}

	/**
	 * Get failure summary for reporting.
	 * Returns empty string if no failures.
	 */
	getFailureSummary(runTag: string): string {
		const failures = this.getChunkingFailures(runTag);
		if (failures.length === 0) return "";

		// Group by error type
		const errorCounts = new Map<string, number>();
		for (const { error } of failures) {
			// Take first part of error as the error type
			const key = error.split(":")[0] ?? error;
			errorCounts.set(key, (errorCounts.get(key) ?? 0) + 1);
		}

		const lines = [`${failures.length} chunking failures:`];
		for (const [errorType, count] of errorCounts) {
			lines.push(`  - ${errorType}: ${count} files`);
		}
		return lines.join("\n");
	}

	/**
	 * Check if failure rate exceeds threshold and throw if so.
	 * Used for fail-fast behavior to detect systemic issues early.
	 *
	 * @param runTag - The run identifier
	 * @param totalContexts - Total number of contexts attempted
	 * @param threshold - Failure rate threshold (default 10%)
	 */
	checkFailureRate(
		runTag: string,
		totalContexts: number,
		threshold = 0.1,
	): void {
		const failures = this.getChunkingFailures(runTag);
		if (totalContexts === 0) return;

		const failureRate = failures.length / totalContexts;

		if (failureRate > threshold) {
			throw new Error(
				`Chunking failure rate too high: ${(failureRate * 100).toFixed(1)}% ` +
					`(${failures.length}/${totalContexts}). ` +
					`This likely indicates a configuration or infrastructure issue.\n` +
					this.getFailureSummary(runTag),
			);
		}
	}
}

export default GenericChunkerProvider;
