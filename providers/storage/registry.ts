/**
 * Vector Store Registry
 *
 * Registry for pluggable vector store implementations.
 * Enables users to register custom storage backends (Pinecone, Weaviate, Mem0, etc.)
 * without modifying core code.
 */

import { BaseRegistry } from "../../core/registry/index.ts";
import type { VectorStore } from "./vector-store.ts";
import { InMemoryVectorStore } from "./in-memory-store.ts";

/**
 * Factory function to create a VectorStore instance.
 * Can accept configuration options.
 */
export type VectorStoreFactory = (config?: Record<string, unknown>) => VectorStore;

/**
 * Definition of a vector store implementation.
 */
export interface VectorStoreDefinition {
	/** Store name (e.g., "in-memory", "pinecone", "weaviate") */
	name: string;
	/** Optional aliases */
	aliases?: readonly string[];
	/** Factory function to create store instance */
	factory: VectorStoreFactory;
	/** Optional description */
	description?: string;
}

/**
 * Registry for vector store implementations.
 */
export class VectorStoreRegistry extends BaseRegistry<VectorStoreDefinition> {
	constructor() {
		super({ name: "VectorStoreRegistry", throwOnConflict: true });
	}

	/**
	 * Register a vector store definition.
	 */
	register(def: VectorStoreDefinition): void {
		if (!def.factory || typeof def.factory !== "function") {
			throw new Error(
				`Invalid VectorStoreDefinition: "${def.name}" must have factory function`
			);
		}
		this.registerItem(def.name, def, def.aliases);
	}

	/**
	 * Create a vector store instance by name.
	 */
	createStore(nameOrAlias: string, config?: Record<string, unknown>): VectorStore {
		const def = this.get(nameOrAlias);
		if (!def) {
			throw new Error(
				`Unknown vector store: "${nameOrAlias}". ` +
				`Available stores: ${this.keys().join(", ")}`
			);
		}
		return def.factory(config);
	}
}

// Singleton instance
let globalVectorStoreRegistry: VectorStoreRegistry | null = null;

export function getVectorStoreRegistry(): VectorStoreRegistry {
	if (!globalVectorStoreRegistry) {
		globalVectorStoreRegistry = new VectorStoreRegistry();
		// Register built-in stores
		registerBuiltinVectorStores();
	}
	return globalVectorStoreRegistry;
}

export function resetVectorStoreRegistry(): void {
	globalVectorStoreRegistry = null;
}

/**
 * Register built-in vector stores.
 */
function registerBuiltinVectorStores(): void {
	getVectorStoreRegistry().register({
		name: "in-memory",
		aliases: ["memory", "default"],
		description: "In-memory vector store (default)",
		factory: () => new InMemoryVectorStore(),
	});
}

// Backward-compatible exports
export function registerVectorStore(def: VectorStoreDefinition): void {
	getVectorStoreRegistry().register(def);
}

export function createVectorStore(name: string, config?: Record<string, unknown>): VectorStore {
	return getVectorStoreRegistry().createStore(name, config);
}
