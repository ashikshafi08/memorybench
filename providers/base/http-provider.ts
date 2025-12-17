/**
 * Generic HTTP provider adapter for hosted API providers.
 * Uses JSONPath to map request/response data per YAML config.
 */

import { JSONPath } from "jsonpath-plus";
import type { ProviderConfig, PreparedData, SearchResult } from "../../core/config.ts";
import { interpolateEnvVars } from "../../core/registry.ts";
import {
	BaseProvider,
	type ProviderCapabilities,
	type SearchOptions,
} from "./types.ts";

/**
 * Checks if an HTTP error is transient and should be retried.
 */
function isTransientError(error: unknown): boolean {
	if (error instanceof HttpProviderError) {
		const status = error.statusCode;
		// Retry on rate limits (429) and server errors (5xx)
		return status === 429 || (status >= 500 && status < 600);
	}
	// Retry on network errors
	if (error instanceof TypeError && error.message.includes("fetch")) {
		return true;
	}
	return false;
}

export class HttpProviderError extends Error {
	constructor(
		message: string,
		public readonly statusCode: number,
		public readonly body?: string,
	) {
		super(message);
		this.name = "HttpProviderError";
	}
}

export class HttpProvider extends BaseProvider {
	readonly name: string;
	readonly displayName: string;
	readonly capabilities: ProviderCapabilities;

	private baseUrl: string;
	private timeout: number;
	private authHeader: string | null = null;
	private addDelayMs: number;
	private searchDelayMs: number;
	private maxRetries: number;
	private retryDelayMs: number;

	constructor(private config: ProviderConfig) {
		super();

		if (config.type !== "hosted" && config.type !== "docker") {
			throw new Error(
				`HttpProvider only supports 'hosted' or 'docker' types, got '${config.type}'`,
			);
		}

		this.name = config.name;
		this.displayName = config.displayName;

		this.capabilities = {
			supportsChunks: config.capabilities?.supportsChunks ?? false,
			supportsBatch: config.capabilities?.supportsBatch ?? false,
			supportsMetadata: config.capabilities?.supportsMetadata ?? true,
			supportsRerank: config.capabilities?.supportsRerank ?? false,
		};

		// Resolve connection settings
		const connection = config.connection;
		if (!connection) {
			throw new Error(`HttpProvider requires 'connection' config for ${config.name}`);
		}

		this.baseUrl = this.resolveBaseUrl(connection.baseUrl);
		this.timeout = connection.timeout ?? 30000;

		// Resolve auth
		this.authHeader = this.resolveAuthHeader();

		// Rate limiting
		const rateLimit = config.rateLimit;
		this.addDelayMs = rateLimit?.addDelayMs ?? 0;
		this.searchDelayMs = rateLimit?.searchDelayMs ?? 0;
		this.maxRetries = rateLimit?.maxRetries ?? 3;
		this.retryDelayMs = rateLimit?.retryDelayMs ?? 2000;

		// Validate endpoints exist
		if (!config.endpoints) {
			throw new Error(`HttpProvider requires 'endpoints' config for ${config.name}`);
		}
	}

	/**
	 * Resolve environment variables in the base URL.
	 */
	private resolveBaseUrl(url: string): string {
		return interpolateEnvVars(url);
	}

	/**
	 * Build the authorization header value.
	 */
	private resolveAuthHeader(): string | null {
		const auth = this.config.auth;
		if (!auth || auth.type === "none") {
			return null;
		}

		const envVar = auth.envVar;
		if (!envVar) {
			throw new Error(
				`Auth config for ${this.name} requires 'envVar' when type is not 'none'`,
			);
		}

		const apiKey = process.env[envVar];
		if (!apiKey) {
			throw new Error(
				`Missing API key: environment variable '${envVar}' is not set for provider '${this.name}'`,
			);
		}

		const prefix = auth.prefix ?? (auth.type === "bearer" ? "Bearer " : "");
		return `${prefix}${apiKey}`;
	}

	/**
	 * Build request headers.
	 */
	private getHeaders(): Headers {
		const headers = new Headers({
			"Content-Type": "application/json",
		});

		if (this.authHeader) {
			const headerName = this.config.auth?.header ?? "Authorization";
			headers.set(headerName, this.authHeader);
		}

		return headers;
	}

	/**
	 * Replace JSONPath placeholders in a body template with actual data.
	 */
	private mapBody(template: Record<string, unknown>, data: Record<string, unknown>): Record<string, unknown> {
		const result: Record<string, unknown> = {};

		for (const [key, value] of Object.entries(template)) {
			if (typeof value === "string" && value.startsWith("$.")) {
				// JSONPath reference to data
				const path = value;
				const resolved = JSONPath({ path, json: data, wrap: false });
				result[key] = resolved;
			} else if (Array.isArray(value)) {
				// Handle arrays (might contain JSONPath refs)
				result[key] = value.map((item) => {
					if (typeof item === "string" && item.startsWith("$.")) {
						return JSONPath({ path: item, json: data, wrap: false });
					}
					if (typeof item === "object" && item !== null) {
						return this.mapBody(item as Record<string, unknown>, data);
					}
					return item;
				});
			} else if (typeof value === "object" && value !== null) {
				// Nested object
				result[key] = this.mapBody(value as Record<string, unknown>, data);
			} else {
				// Literal value
				result[key] = value;
			}
		}

		return result;
	}

	/**
	 * Replace path template variables (e.g., ${runTag}).
	 */
	private resolvePath(path: string, data: Record<string, unknown>): string {
		return path.replace(/\$\{(\w+)\}/g, (_, key) => {
			const value = data[key];
			return value !== undefined ? String(value) : "";
		});
	}

	/**
	 * Make an HTTP request with retry logic.
	 */
	private async request(
		method: string,
		path: string,
		body?: Record<string, unknown>,
	): Promise<unknown> {
		const url = `${this.baseUrl}${path}`;
		const headers = this.getHeaders();

		const operation = async (): Promise<unknown> => {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), this.timeout);

			try {
				const response = await fetch(url, {
					method,
					headers,
					body: body ? JSON.stringify(body) : undefined,
					signal: controller.signal,
				});

				if (!response.ok) {
					const text = await response.text();
					throw new HttpProviderError(
						`HTTP ${response.status}: ${response.statusText}`,
						response.status,
						text,
					);
				}

				// Handle empty responses
				const contentType = response.headers.get("content-type");
				if (
					contentType?.includes("application/json") &&
					response.status !== 204
				) {
					return await response.json();
				}

				return null;
			} finally {
				clearTimeout(timeoutId);
			}
		};

		return this.retry(operation, {
			maxRetries: this.maxRetries,
			retryDelayMs: this.retryDelayMs,
			shouldRetry: isTransientError,
		});
	}

	/**
	 * Add context to the provider.
	 */
	async addContext(data: PreparedData, runTag: string): Promise<void> {
		const endpoint = this.config.endpoints!.add;

		// Build request data with runTag
		const requestData = {
			...data,
			...data.metadata,
			runTag,
			userId: runTag, // Some providers use userId for scoping
		};

		// Map body template
		const body = endpoint.body
			? this.mapBody(endpoint.body as Record<string, unknown>, requestData)
			: requestData;

		// Resolve path
		const path = this.resolvePath(endpoint.path, requestData);

		await this.request(endpoint.method, path, body);

		// Rate limiting
		if (this.addDelayMs > 0) {
			await this.sleep(this.addDelayMs);
		}
	}

	/**
	 * Search for relevant context.
	 */
	async searchQuery(
		query: string,
		runTag: string,
		options?: SearchOptions,
	): Promise<SearchResult[]> {
		const endpoint = this.config.endpoints!.search;

		// Build request data
		const requestData = {
			query,
			runTag,
			userId: runTag,
			limit: options?.limit ?? 10,
			threshold: options?.threshold ?? 0.3,
			includeChunks: options?.includeChunks ?? this.capabilities.supportsChunks,
		};

		// Map body template
		const body = endpoint.body
			? this.mapBody(endpoint.body as Record<string, unknown>, requestData)
			: requestData;

		// Resolve path
		const path = this.resolvePath(endpoint.path, requestData);

		// Make request
		const response = await this.request(endpoint.method, path, body);

		// Rate limiting
		if (this.searchDelayMs > 0) {
			await this.sleep(this.searchDelayMs);
		}

		// Map response to SearchResult[]
		return this.mapSearchResponse(response, endpoint.response);
	}

	/**
	 * Map API response to SearchResult array using JSONPath config.
	 */
	private mapSearchResponse(
		response: unknown,
		responseConfig?: {
			results: string;
			contentField: string;
			scoreField?: string;
			chunksField?: string;
		},
	): SearchResult[] {
		if (!response || !responseConfig) {
			return [];
		}

		// Extract results array
		const results = JSONPath({
			path: responseConfig.results,
			json: response as object,
			wrap: false,
		});

		if (!Array.isArray(results)) {
			return [];
		}

		return results.map((item: unknown, index: number) => {
			const itemObj = item as Record<string, unknown>;

			// Extract content
			const content = responseConfig.contentField
				? JSONPath({
						path: responseConfig.contentField,
						json: itemObj,
						wrap: false,
					})
				: itemObj.content ?? itemObj.text ?? "";

			// Extract score
			const score = responseConfig.scoreField
				? JSONPath({
						path: responseConfig.scoreField,
						json: itemObj,
						wrap: false,
					})
				: itemObj.score ?? 1 - index * 0.1;

			// Extract chunks if available
			let chunks: Array<{ content: string; score: number }> | undefined;
			if (responseConfig.chunksField) {
				const rawChunks = JSONPath({
					path: responseConfig.chunksField,
					json: itemObj,
					wrap: false,
				});
				if (Array.isArray(rawChunks)) {
					chunks = rawChunks.map((chunk: unknown, chunkIndex: number) => ({
						content: String(
							typeof chunk === "string"
								? chunk
								: (chunk as Record<string, unknown>).content ??
									(chunk as Record<string, unknown>).text ??
									"",
						),
						score:
							typeof (chunk as Record<string, unknown>).score === "number"
								? (chunk as Record<string, unknown>).score as number
								: 1 - chunkIndex * 0.05,
					}));
				}
			}

			return {
				id: (itemObj.id as string) ?? `result-${index}`,
				content: String(content),
				score: Number(score),
				chunks,
				metadata: itemObj.metadata as Record<string, unknown> | undefined,
			};
		});
	}

	/**
	 * Clear all data for a run tag.
	 */
	async clear(runTag: string): Promise<void> {
		const endpoint = this.config.endpoints!.clear;
		if (!endpoint) {
			// Clear is optional
			return;
		}

		const requestData = {
			runTag,
			userId: runTag,
		};

		// Resolve path
		const path = this.resolvePath(endpoint.path, requestData);

		// Map body if present
		const body = endpoint.body
			? this.mapBody(endpoint.body as Record<string, unknown>, requestData)
			: undefined;

		await this.request(endpoint.method, path, body);
	}
}

