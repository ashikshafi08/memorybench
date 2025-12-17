/**
 * Adapter that wraps the existing AQRAG provider implementation.
 */

import type { ProviderConfig, PreparedData, SearchResult } from "../../core/config.ts";
import { LocalProvider } from "../base/local-provider.ts";
import type { SearchOptions } from "../base/types.ts";

// Lazy imports to avoid initialization issues
let addDocument: typeof import("../AQRAG/src/add.ts").addDocument;
let retrieve: typeof import("../AQRAG/src/retrieve.ts").retrieve;
let initDatabase: typeof import("../AQRAG/src/db.ts").initDatabase;

export class AQRAGAdapter extends LocalProvider {
	constructor(config: ProviderConfig) {
		super(config);
	}

	protected async doInitialize(): Promise<void> {
		// Dynamically import the AQRAG modules
		const addModule = await import("../AQRAG/src/add.ts");
		const retrieveModule = await import("../AQRAG/src/retrieve.ts");
		const dbModule = await import("../AQRAG/src/db.ts");

		addDocument = addModule.addDocument;
		retrieve = retrieveModule.retrieve;
		initDatabase = dbModule.initDatabase;

		// Initialize the database
		await initDatabase();
	}

	protected async doCleanup(): Promise<void> {
		// AQRAG doesn't have explicit cleanup
	}

	async addContext(data: PreparedData, _runTag: string): Promise<void> {
		this.ensureInitialized();

		// The original AQRAG uses data.context as content
		await addDocument(data.content);
	}

	async searchQuery(
		query: string,
		_runTag: string,
		options?: SearchOptions,
	): Promise<SearchResult[]> {
		this.ensureInitialized();

		const results = await retrieve(query);

		// Map to SearchResult format
		const mappedResults = results.map((result) => ({
			id: result.id.toString(),
			content: result.content,
			score: result.similarity_score,
			metadata: {},
		}));

		// Apply limit if specified
		const limit = options?.limit ?? 10;
		return mappedResults.slice(0, limit);
	}

	async clear(_runTag: string): Promise<void> {
		// AQRAG doesn't have a clear method yet
		// This would require adding database cleanup functionality
		console.warn(
			`AQRAG provider does not support clearing data. Run tag: ${_runTag}`,
		);
	}
}

export default AQRAGAdapter;

