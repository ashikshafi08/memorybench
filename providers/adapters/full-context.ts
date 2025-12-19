/**
 * Full-Context Baseline Providers
 * 
 * These providers return all contexts without retrieval, enabling "Full-context vs Provider" comparisons.
 * 
 * - full-context-session: Returns all sessions as retrieved context
 * - full-context-turn: Returns all turns as retrieved context
 */

import { BaseProvider } from "../base/types.ts";
import type { ProviderConfig, PreparedData, SearchResult } from "../../core/config.ts";
import type { ProviderCapabilities, SearchOptions } from "../base/types.ts";

/**
 * Full-context session baseline provider.
 * Returns all sessions (grouped by session) as retrieved context.
 */
export class FullContextSessionProvider extends BaseProvider {
	readonly name = "full-context-session";
	readonly displayName = "Full-Context (Session)";
	readonly capabilities: ProviderCapabilities = {
		supportsChunks: false,
		supportsBatch: false,
		supportsMetadata: true,
		supportsRerank: false,
	};

	private contextsByRunTag = new Map<string, Map<string, PreparedData[]>>();

	async addContext(data: PreparedData, runTag: string): Promise<void> {
		if (!this.contextsByRunTag.has(runTag)) {
			this.contextsByRunTag.set(runTag, new Map());
		}

		const contexts = this.contextsByRunTag.get(runTag)!;
		
		// Group by session (use sessionKey from metadata if available, otherwise use ID prefix)
		const sessionKey = (data.metadata?.sessionKey as string | undefined) ||
			data.id.split("-session-")[0] ||
			"default";
		
		if (!contexts.has(sessionKey)) {
			contexts.set(sessionKey, []);
		}
		
		contexts.get(sessionKey)!.push(data);
	}

	async searchQuery(
		query: string,
		runTag: string,
		options?: SearchOptions,
	): Promise<SearchResult[]> {
		const contexts = this.contextsByRunTag.get(runTag);
		if (!contexts) {
			return [];
		}

		const results: SearchResult[] = [];
		
		// Return all sessions as retrieved context
		for (const [sessionKey, sessionContexts] of contexts.entries()) {
			// Combine all contexts in this session into one result
			const combinedContent = sessionContexts
				.map((ctx) => ctx.content)
				.join("\n\n");
			
			results.push({
				id: `session-${sessionKey}`,
				content: combinedContent,
				score: 1.0, // Perfect score (all contexts included)
				metadata: {
					sessionKey,
					count: sessionContexts.length,
					baseline: "full-context-session",
				},
			});
		}

		// Apply limit if specified
		const limit = options?.limit ?? results.length;
		return results.slice(0, limit);
	}

	async clear(runTag: string): Promise<void> {
		this.contextsByRunTag.delete(runTag);
	}
}

/**
 * Full-context turn baseline provider.
 * Returns all turns (individual messages) as retrieved context.
 */
export class FullContextTurnProvider extends BaseProvider {
	readonly name = "full-context-turn";
	readonly displayName = "Full-Context (Turn)";
	readonly capabilities: ProviderCapabilities = {
		supportsChunks: false,
		supportsBatch: false,
		supportsMetadata: true,
		supportsRerank: false,
	};

	private contextsByRunTag = new Map<string, PreparedData[]>();

	async addContext(data: PreparedData, runTag: string): Promise<void> {
		if (!this.contextsByRunTag.has(runTag)) {
			this.contextsByRunTag.set(runTag, []);
		}

		this.contextsByRunTag.get(runTag)!.push(data);
	}

	async searchQuery(
		query: string,
		runTag: string,
		options?: SearchOptions,
	): Promise<SearchResult[]> {
		const contexts = this.contextsByRunTag.get(runTag);
		if (!contexts) {
			return [];
		}

		// Return all turns as retrieved context
		const results: SearchResult[] = contexts.map((ctx) => ({
			id: ctx.id,
			content: ctx.content,
			score: 1.0, // Perfect score (all contexts included)
			metadata: {
				...ctx.metadata,
				baseline: "full-context-turn",
			},
		}));

		// Apply limit if specified
		const limit = options?.limit ?? results.length;
		return results.slice(0, limit);
	}

	async clear(runTag: string): Promise<void> {
		this.contextsByRunTag.delete(runTag);
	}
}

