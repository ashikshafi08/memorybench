/**
 * Adapter that wraps the existing ContextualRetrieval provider implementation.
 */

import type { ProviderConfig, PreparedData, SearchResult } from "../../core/config.ts";
import { LocalProvider } from "../base/local-provider.ts";
import type { SearchOptions } from "../base/types.ts";

// Lazy imports to avoid initialization issues
let processDocument: typeof import("../ContextualRetrieval/src/add.ts").processDocument;
let retrieve: typeof import("../ContextualRetrieval/src/retrieve.ts").retrieve;
let initDatabase: typeof import("../ContextualRetrieval/src/db.ts").initDatabase;

export class ContextualRetrievalAdapter extends LocalProvider {
	constructor(config: ProviderConfig) {
		super(config);
	}

	protected async doInitialize(): Promise<void> {
		// Dynamically import the ContextualRetrieval modules
		const addModule = await import("../ContextualRetrieval/src/add.ts");
		const retrieveModule = await import("../ContextualRetrieval/src/retrieve.ts");
		const dbModule = await import("../ContextualRetrieval/src/db.ts");

		processDocument = addModule.processDocument;
		retrieve = retrieveModule.retrieve;
		initDatabase = dbModule.initDatabase;

		// Initialize the database
		await initDatabase();
	}

	protected async doCleanup(): Promise<void> {
		// ContextualRetrieval doesn't have explicit cleanup
	}

	async addContext(data: PreparedData, _runTag: string): Promise<void> {
		this.ensureInitialized();

		// The original ContextualRetrieval uses data.context as content
		await processDocument(data.content);
	}

	async searchQuery(
		query: string,
		_runTag: string,
		options?: SearchOptions,
	): Promise<SearchResult[]> {
		this.ensureInitialized();

		const results = await retrieve(query);

		// Map to SearchResult format
		const mappedResults = results.map((chunk) => ({
			id: chunk.id.toString(),
			content: chunk.content,
			score: chunk.similarity_score || 0,
			metadata: {},
		}));

		// Apply limit if specified
		const limit = options?.limit ?? 10;
		return mappedResults.slice(0, limit);
	}

	async clear(_runTag: string): Promise<void> {
		// ContextualRetrieval doesn't have a clear method yet
		// This would require adding database cleanup functionality
		console.warn(
			`ContextualRetrieval provider does not support clearing data. Run tag: ${_runTag}`,
		);
	}
}

export default ContextualRetrievalAdapter;

