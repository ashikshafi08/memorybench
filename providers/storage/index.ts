/**
 * Vector Storage Module
 *
 * Provides pluggable vector storage for chunking providers.
 */

export type {
	VectorStore,
	StoredChunk,
	SearchOptions,
	ScoredChunk,
} from "./vector-store.ts";

export { InMemoryVectorStore } from "./in-memory-store.ts";

export {
	VectorStoreRegistry,
	getVectorStoreRegistry,
	resetVectorStoreRegistry,
	registerVectorStore,
	createVectorStore,
	type VectorStoreDefinition,
	type VectorStoreFactory,
} from "./registry.ts";
