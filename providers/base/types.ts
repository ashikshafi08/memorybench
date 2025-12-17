/**
 * Core provider types and interfaces for memorybench.
 */

import type { ProviderConfig, PreparedData, SearchResult } from "../../core/config.ts";

/**
 * Runtime provider interface that all providers must implement.
 */
export interface Provider {
	/** Provider name (from config) */
	readonly name: string;

	/** Provider display name */
	readonly displayName: string;

	/** Provider capabilities */
	readonly capabilities: ProviderCapabilities;

	/**
	 * Add context/documents to the provider.
	 * @param data - The prepared data to add
	 * @param runTag - Unique tag for this benchmark run (for scoping)
	 */
	addContext(data: PreparedData, runTag: string): Promise<void>;

	/**
	 * Search for relevant context given a query.
	 * @param query - The search query
	 * @param runTag - Unique tag for this benchmark run (for scoping)
	 * @param options - Optional search parameters
	 */
	searchQuery(
		query: string,
		runTag: string,
		options?: SearchOptions,
	): Promise<SearchResult[]>;

	/**
	 * Clear all data for a given run tag.
	 * @param runTag - Unique tag for this benchmark run
	 */
	clear(runTag: string): Promise<void>;

	/**
	 * Initialize the provider (e.g., start Docker containers, connect to DB).
	 */
	initialize?(): Promise<void>;

	/**
	 * Cleanup resources (e.g., stop containers, close connections).
	 */
	cleanup?(): Promise<void>;
}

export interface ProviderCapabilities {
	supportsChunks: boolean;
	supportsBatch: boolean;
	supportsMetadata: boolean;
	supportsRerank: boolean;
}

export interface SearchOptions {
	limit?: number;
	threshold?: number;
	includeChunks?: boolean;
}

/**
 * Abstract base class for providers with common functionality.
 */
export abstract class BaseProvider implements Provider {
	abstract readonly name: string;
	abstract readonly displayName: string;
	abstract readonly capabilities: ProviderCapabilities;

	abstract addContext(data: PreparedData, runTag: string): Promise<void>;
	abstract searchQuery(
		query: string,
		runTag: string,
		options?: SearchOptions,
	): Promise<SearchResult[]>;
	abstract clear(runTag: string): Promise<void>;

	async initialize(): Promise<void> {
		// Default no-op
	}

	async cleanup(): Promise<void> {
		// Default no-op
	}

	/**
	 * Sleep for a specified duration (for rate limiting).
	 */
	protected sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * Retry an operation with exponential backoff.
	 */
	protected async retry<T>(
		operation: () => Promise<T>,
		options: {
			maxRetries: number;
			retryDelayMs: number;
			shouldRetry?: (error: unknown) => boolean;
		},
	): Promise<T> {
		let lastError: unknown;

		for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
			try {
				return await operation();
			} catch (error) {
				lastError = error;

				// Check if we should retry
				if (options.shouldRetry && !options.shouldRetry(error)) {
					throw error;
				}

				// Don't sleep on the last attempt
				if (attempt < options.maxRetries) {
					const delay = options.retryDelayMs * Math.pow(2, attempt);
					await this.sleep(delay);
				}
			}
		}

		throw lastError;
	}
}

/**
 * Factory function type for creating providers from config.
 */
export type ProviderFactory = (config: ProviderConfig) => Promise<Provider>;

