/**
 * Simple RAG adapter using OpenRouter for embeddings
 */

import type { ProviderConfig, PreparedData, SearchResult } from "../../core/config.ts";
import { LocalProvider } from "../base/local-provider.ts";
import type { SearchOptions } from "../base/types.ts";

// Lazy imports to avoid initialization issues
let addDocument: typeof import("../OpenRouterRAG/src/add.ts").addDocument;
let retrieve: typeof import("../OpenRouterRAG/src/retrieve.ts").retrieve;
let initDatabase: typeof import("../OpenRouterRAG/src/db.ts").initDatabase;
let deleteDocumentsByRunTag: typeof import("../OpenRouterRAG/src/db.ts").deleteDocumentsByRunTag;

export class OpenRouterRAGAdapter extends LocalProvider {
	constructor(config: ProviderConfig) {
		super(config);
	}

	protected async doInitialize(): Promise<void> {
		// Dynamically import the OpenRouterRAG modules
		const addModule = await import("../OpenRouterRAG/src/add.ts");
		const retrieveModule = await import("../OpenRouterRAG/src/retrieve.ts");
		const dbModule = await import("../OpenRouterRAG/src/db.ts");

		addDocument = addModule.addDocument;
		retrieve = retrieveModule.retrieve;
		initDatabase = dbModule.initDatabase;
		deleteDocumentsByRunTag = dbModule.deleteDocumentsByRunTag;

		// Initialize the database
		await initDatabase();
	}

	protected async doCleanup(): Promise<void> {
		// No cleanup needed
	}

	async addContext(data: PreparedData, runTag: string): Promise<void> {
		this.ensureInitialized();

		// Add document with runTag for isolation
		await addDocument(data.content, runTag);
	}

	async searchQuery(
		query: string,
		runTag: string,
		options?: SearchOptions,
	): Promise<SearchResult[]> {
		this.ensureInitialized();

		const limit = options?.limit ?? 5;

		// Retrieve relevant chunks
		const results = await retrieve(query, runTag, limit);

		// Map to SearchResult format
		return results.map((result) => ({
			id: result.id.toString(),
			content: result.content,
			score: result.similarity_score,
			metadata: {},
		}));
	}

	async clear(runTag: string): Promise<void> {
		this.ensureInitialized();

		// Delete all documents for this runTag
		await deleteDocumentsByRunTag(runTag);
	}
}

export default OpenRouterRAGAdapter;
