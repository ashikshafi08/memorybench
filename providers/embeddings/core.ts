/**
 * Embedding Core
 *
 * Types, interfaces, cache, and shared utilities for embedding providers.
 * This consolidates interface.ts and cache.ts into a single file.
 */

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

// ============================================================================
// Types
// ============================================================================

/**
 * Embedding vector result.
 */
export interface EmbeddingResult {
	/** The embedding vector */
	vector: number[];
	/** Number of tokens in the input (if available) */
	tokenCount?: number;
	/** Whether this result came from cache */
	fromCache?: boolean;
}

/**
 * Batch embedding result.
 */
export interface BatchEmbeddingResult {
	/** Embeddings in same order as input texts */
	embeddings: EmbeddingResult[];
	/** Total tokens across all inputs */
	totalTokens: number;
	/** Number of cache hits */
	cacheHits: number;
	/** Number of API calls made */
	apiCalls: number;
}

/**
 * Embedding provider configuration.
 */
export interface EmbeddingProviderConfig {
	/** Provider name (e.g., "openai", "voyage") */
	provider: string;
	/** Model identifier (e.g., "text-embedding-3-small", "voyage-code-3") */
	model: string;
	/** Vector dimensions (optional, for truncation) */
	dimensions?: number;
	/** API key (optional, can use env vars) */
	apiKey?: string;
	/** Enable disk caching (default: true) */
	cacheEnabled?: boolean;
	/** Cache directory (default: .cache/embeddings) */
	cacheDir?: string;
}

/**
 * Embedding call statistics for cost tracking.
 */
export interface EmbeddingStats {
	/** Total API calls made */
	apiCalls: number;
	/** Total tokens embedded */
	totalTokens: number;
	/** Cache hits */
	cacheHits: number;
	/** Cache misses (API calls) */
	cacheMisses: number;
}

/**
 * Embedding provider interface.
 *
 * Implementations should handle:
 * - Single and batch embedding
 * - Rate limiting / retries
 * - Caching (via composition with EmbeddingCache)
 */
export interface EmbeddingProvider {
	/** Provider identifier (e.g., "openai", "voyage") */
	readonly provider: string;
	/** Model identifier */
	readonly model: string;
	/** Vector dimensions */
	readonly dimensions: number;

	/**
	 * Embed a single text string.
	 */
	embed(text: string): Promise<EmbeddingResult>;

	/**
	 * Embed multiple texts in a batch.
	 * Implementations should handle chunking for API limits.
	 */
	embedBatch(texts: string[]): Promise<BatchEmbeddingResult>;

	/**
	 * Get current statistics.
	 */
	getStats(): EmbeddingStats;

	/**
	 * Reset statistics.
	 */
	resetStats(): void;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length) {
		throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
	}

	let dotProduct = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < a.length; i++) {
		dotProduct += a[i]! * b[i]!;
		normA += a[i]! * a[i]!;
		normB += b[i]! * b[i]!;
	}

	if (normA === 0 || normB === 0) {
		return 0;
	}

	return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ============================================================================
// Cache
// ============================================================================

/**
 * Cached embedding entry.
 */
interface CacheEntry {
	vector: number[];
	tokenCount?: number;
	createdAt: string;
	model: string;
}

/**
 * Disk-based embedding cache.
 *
 * Caches embedding vectors to disk to avoid redundant API calls.
 * Cache key is sha256(text) + modelId.
 */
export class EmbeddingCache {
	private readonly cacheDir: string;
	private readonly model: string;
	private hits = 0;
	private misses = 0;

	constructor(cacheDir: string, model: string) {
		this.cacheDir = cacheDir;
		this.model = model;
		this.ensureCacheDir();
	}

	/**
	 * Get cached embedding if exists.
	 */
	get(text: string): CacheEntry | null {
		const key = this.getCacheKey(text);
		const filePath = this.getCacheFilePath(key);

		if (!existsSync(filePath)) {
			this.misses++;
			return null;
		}

		try {
			const data = readFileSync(filePath, "utf-8");
			const entry = JSON.parse(data) as CacheEntry;

			// Validate model matches
			if (entry.model !== this.model) {
				this.misses++;
				return null;
			}

			this.hits++;
			return entry;
		} catch {
			this.misses++;
			return null;
		}
	}

	/**
	 * Store embedding in cache.
	 */
	set(text: string, vector: number[], tokenCount?: number): void {
		const key = this.getCacheKey(text);
		const filePath = this.getCacheFilePath(key);

		const entry: CacheEntry = {
			vector,
			tokenCount,
			createdAt: new Date().toISOString(),
			model: this.model,
		};

		try {
			// Ensure subdirectory exists (use first 2 chars of hash for sharding)
			const subDir = join(this.cacheDir, key.slice(0, 2));
			if (!existsSync(subDir)) {
				mkdirSync(subDir, { recursive: true });
			}

			writeFileSync(filePath, JSON.stringify(entry));
		} catch (error) {
			console.warn(`Failed to write embedding cache: ${error}`);
		}
	}

	/**
	 * Get cache statistics.
	 */
	getStats(): { hits: number; misses: number } {
		return { hits: this.hits, misses: this.misses };
	}

	/**
	 * Reset statistics.
	 */
	resetStats(): void {
		this.hits = 0;
		this.misses = 0;
	}

	/**
	 * Generate cache key from text and model.
	 */
	private getCacheKey(text: string): string {
		const hash = createHash("sha256");
		hash.update(text);
		hash.update(this.model);
		return hash.digest("hex");
	}

	/**
	 * Get file path for a cache key.
	 * Uses sharding by first 2 chars of hash to avoid too many files in one dir.
	 */
	private getCacheFilePath(key: string): string {
		const subDir = key.slice(0, 2);
		return join(this.cacheDir, subDir, `${key}.json`);
	}

	/**
	 * Ensure cache directory exists.
	 */
	private ensureCacheDir(): void {
		if (!existsSync(this.cacheDir)) {
			mkdirSync(this.cacheDir, { recursive: true });
		}
	}
}
