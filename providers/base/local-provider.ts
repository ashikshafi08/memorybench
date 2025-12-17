/**
 * Base class for local (in-process) provider implementations.
 */

import type { ProviderConfig, PreparedData, SearchResult } from "../../core/config.ts";
import {
	BaseProvider,
	type ProviderCapabilities,
	type SearchOptions,
} from "./types.ts";

/**
 * Abstract base class for local providers that run in-process.
 * Handles common functionality like initialization and cleanup.
 */
export abstract class LocalProvider extends BaseProvider {
	readonly name: string;
	readonly displayName: string;
	readonly capabilities: ProviderCapabilities;

	protected config: ProviderConfig;
	protected initialized = false;

	constructor(config: ProviderConfig) {
		super();

		if (config.type !== "local") {
			throw new Error(
				`LocalProvider only supports 'local' type, got '${config.type}'`,
			);
		}

		this.config = config;
		this.name = config.name;
		this.displayName = config.displayName;

		this.capabilities = {
			supportsChunks: config.capabilities?.supportsChunks ?? false,
			supportsBatch: config.capabilities?.supportsBatch ?? false,
			supportsMetadata: config.capabilities?.supportsMetadata ?? true,
			supportsRerank: config.capabilities?.supportsRerank ?? false,
		};
	}

	/**
	 * Initialize the provider (e.g., connect to database).
	 * Subclasses should override this to perform initialization.
	 */
	override async initialize(): Promise<void> {
		if (this.initialized) {
			return;
		}
		await this.doInitialize();
		this.initialized = true;
	}

	/**
	 * Override this in subclasses to perform actual initialization.
	 */
	protected abstract doInitialize(): Promise<void>;

	/**
	 * Cleanup resources.
	 * Subclasses should override this to perform cleanup.
	 */
	override async cleanup(): Promise<void> {
		if (!this.initialized) {
			return;
		}
		await this.doCleanup();
		this.initialized = false;
	}

	/**
	 * Override this in subclasses to perform actual cleanup.
	 */
	protected abstract doCleanup(): Promise<void>;

	/**
	 * Ensure the provider is initialized before operations.
	 */
	protected ensureInitialized(): void {
		if (!this.initialized) {
			throw new Error(
				`Provider '${this.name}' is not initialized. Call initialize() first.`,
			);
		}
	}

	abstract override addContext(data: PreparedData, runTag: string): Promise<void>;
	abstract override searchQuery(
		query: string,
		runTag: string,
		options?: SearchOptions,
	): Promise<SearchResult[]>;
	abstract override clear(runTag: string): Promise<void>;
}

