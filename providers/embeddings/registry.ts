/**
 * Embedding Provider Registry
 *
 * Registry-based embedding provider creation.
 * Replaces switch statement in providers.ts with pluggable dispatch.
 *
 * Adding a new embedding provider requires only calling registerEmbeddingProvider().
 */

import { BaseRegistry } from "../../core/registry/index.ts";
import type { EmbeddingProvider, EmbeddingProviderConfig } from "./interface.ts";

/**
 * Factory function for creating embedding providers.
 */
export type EmbeddingProviderFactory = (
	config: EmbeddingProviderConfig,
) => EmbeddingProvider;

/**
 * Embedding provider definition.
 */
export interface EmbeddingProviderDefinition {
	/** Provider name (e.g., "openai", "voyage") */
	name: string;
	/** Optional aliases (e.g., "voyageai" for "voyage") */
	aliases?: readonly string[];
	/** Factory function to create provider instance */
	factory: EmbeddingProviderFactory;
}

/**
 * Registry for embedding providers.
 *
 * Extends BaseRegistry with embedding-specific factory invocation.
 */
export class EmbeddingProviderRegistry extends BaseRegistry<EmbeddingProviderDefinition> {
	constructor() {
		super({ name: "EmbeddingProviderRegistry", throwOnConflict: true });
	}

	/**
	 * Register an embedding provider.
	 */
	register(def: EmbeddingProviderDefinition): void {
		this.registerItem(def.name, def, def.aliases);
	}

	/**
	 * Create an embedding provider from configuration.
	 */
	create(config: EmbeddingProviderConfig): EmbeddingProvider {
		const def = this.get(config.provider.toLowerCase());
		if (!def) {
			throw new Error(
				`Unknown embedding provider: ${config.provider}. Supported providers: ${this.keys().join(", ")}`,
			);
		}
		return def.factory(config);
	}

	/**
	 * Get all supported provider names.
	 */
	getSupportedProviders(): string[] {
		return this.keys();
	}
}

// Singleton instance
let globalEmbeddingRegistry: EmbeddingProviderRegistry | null = null;

/**
 * Get the global embedding provider registry.
 */
export function getEmbeddingProviderRegistry(): EmbeddingProviderRegistry {
	if (!globalEmbeddingRegistry) {
		globalEmbeddingRegistry = new EmbeddingProviderRegistry();
	}
	return globalEmbeddingRegistry;
}

/**
 * Reset the embedding provider registry (for testing).
 */
export function resetEmbeddingProviderRegistry(): void {
	globalEmbeddingRegistry = null;
}

/**
 * Register an embedding provider in the global registry.
 */
export function registerEmbeddingProvider(def: EmbeddingProviderDefinition): void {
	getEmbeddingProviderRegistry().register(def);
}
