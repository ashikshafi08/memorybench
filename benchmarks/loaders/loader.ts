/**
 * Main benchmark data loader with schema mapping.
 */

import { JSONPath } from "jsonpath-plus";
import type { BenchmarkConfig, BenchmarkItem, PreparedData } from "../../core/config.ts";
import type { RawDataItem } from "./index.ts";
import { loadLocalData } from "./local.ts";

/**
 * Load benchmark data from the configured source.
 */
export async function loadBenchmarkData(
	config: BenchmarkConfig,
	options?: {
		limit?: number;
		start?: number;
		end?: number;
		questionType?: string;
	},
): Promise<BenchmarkItem[]> {
	// Load raw data
	const rawData = await loadRawData(config);

	// Map to BenchmarkItem format
	let items = mapToBenchmarkItems(rawData, config);

	// Filter by question type if specified
	if (options?.questionType) {
		items = items.filter((item) => item.questionType === options.questionType);
	}

	// Apply range filters
	if (options?.start !== undefined || options?.end !== undefined) {
		const start = (options?.start ?? 1) - 1; // Convert to 0-indexed
		const end = options?.end ?? items.length;
		items = items.slice(start, end);
	}

	// Apply limit
	if (options?.limit !== undefined) {
		items = items.slice(0, options.limit);
	}

	return items;
}

/**
 * Load raw data from the configured source.
 */
async function loadRawData(config: BenchmarkConfig): Promise<RawDataItem[]> {
	const { data } = config;

	switch (data.type) {
		case "local": {
			// Try localPath first, then path
			const path = data.localPath ?? data.path;
			return loadLocalData(path, data.format);
		}

		case "huggingface": {
			// If local cache exists, use it
			if (data.localPath) {
				try {
					return await loadLocalData(data.localPath, data.format);
				} catch {
					// Fall through to download
				}
			}
			// For now, require local cache
			throw new Error(
				`HuggingFace datasets require local cache. Please download ${data.path} to ${data.localPath ?? "./datasets/"}`,
			);
		}

		case "url": {
			// If local cache exists, use it
			if (data.localPath) {
				try {
					return await loadLocalData(data.localPath, data.format);
				} catch {
					// Fall through to download
				}
			}
			// Download from URL
			const response = await fetch(data.path);
			if (!response.ok) {
				throw new Error(`Failed to fetch data from ${data.path}: ${response.status}`);
			}
			const content = await response.text();
			return JSON.parse(content);
		}

		default:
			throw new Error(`Unsupported data source type: ${data.type}`);
	}
}

/**
 * Map raw data items to BenchmarkItem format using schema config.
 */
function mapToBenchmarkItems(
	rawData: RawDataItem[],
	config: BenchmarkConfig,
): BenchmarkItem[] {
	const { schema } = config;
	const items: BenchmarkItem[] = [];

	for (const raw of rawData) {
		// Handle nested questions (LoCoMo style)
		if (schema.questions) {
			const nestedItems = mapNestedQuestions(raw, config);
			items.push(...nestedItems);
		} else {
			// Single question per item (LongMemEval style)
			const item = mapSingleItem(raw, config);
			if (item) {
				items.push(item);
			}
		}
	}

	return items;
}

/**
 * Map a single raw item to a BenchmarkItem.
 */
function mapSingleItem(
	raw: RawDataItem,
	config: BenchmarkConfig,
): BenchmarkItem | null {
	const { schema } = config;

	// Extract ID
	const id = getField(raw, schema.itemId);
	if (!id) {
		console.warn("Skipping item without ID");
		return null;
	}

	// Extract question and answer
	const question = schema.question ? getField(raw, schema.question) : "";
	const answer = schema.answer ? getField(raw, schema.answer) : "";

	// Extract contexts
	const contexts = extractContexts(raw, config);

	// Extract metadata
	const metadata: Record<string, unknown> = {};
	if (schema.metadata) {
		for (const [key, path] of Object.entries(schema.metadata)) {
			metadata[key] = getField(raw, path as string);
		}
	}

	// Determine question type if available
	const questionType = metadata.questionType as string | undefined;

	return {
		id: String(id),
		question: String(question),
		answer: String(answer),
		contexts,
		metadata,
		questionType,
	};
}

/**
 * Map nested questions (LoCoMo style) to multiple BenchmarkItems.
 */
function mapNestedQuestions(
	raw: RawDataItem,
	config: BenchmarkConfig,
): BenchmarkItem[] {
	const { schema } = config;
	const questionsConfig = schema.questions!;

	// Get base item ID
	const baseId = getField(raw, schema.itemId);
	if (!baseId) {
		console.warn("Skipping item without ID");
		return [];
	}

	// Get the questions array
	const questionsArray = getField(raw, questionsConfig.field);
	if (!Array.isArray(questionsArray)) {
		console.warn(`Questions field '${questionsConfig.field}' is not an array`);
		return [];
	}

	// Extract contexts (shared across all questions)
	const contexts = extractContexts(raw, config);

	// Extract shared metadata
	const sharedMetadata: Record<string, unknown> = {};
	if (schema.metadata) {
		for (const [key, path] of Object.entries(schema.metadata)) {
			sharedMetadata[key] = getField(raw, path as string);
		}
	}

	// Map each question to a BenchmarkItem
	const items: BenchmarkItem[] = [];

	for (let i = 0; i < questionsArray.length; i++) {
		const q = questionsArray[i] as Record<string, unknown>;

		const question = String(q[questionsConfig.questionField] ?? "");
		const answer = String(q[questionsConfig.answerField] ?? "");
		const category = q[questionsConfig.categoryField ?? "category"];

		// Map category number to name if available
		let categoryName: string | undefined;
		if (config.categories && category !== undefined) {
			categoryName = (config.categories as Record<string, string>)[String(category)];
		}

		const metadata: Record<string, unknown> = {
			...sharedMetadata,
			questionIndex: i,
			category: categoryName ?? category,
		};

		// Include evidence if available
		if (questionsConfig.evidenceField) {
			metadata.evidence = q[questionsConfig.evidenceField];
		}

		items.push({
			id: `${baseId}-q${i}`,
			question,
			answer,
			contexts,
			metadata,
			category: categoryName,
		});
	}

	return items;
}

/**
 * Extract contexts from a raw item based on schema config.
 */
function extractContexts(
	raw: RawDataItem,
	config: BenchmarkConfig,
): PreparedData[] {
	const { schema, ingestion } = config;
	const contextConfig = schema.context;

	if (!contextConfig) {
		return [];
	}

	const contexts: PreparedData[] = [];
	const contextData = getField(raw, contextConfig.field);

	if (!contextData) {
		return [];
	}

	switch (contextConfig.type) {
		case "array": {
			// Array of context items (e.g., LongMemEval sessions)
			if (!Array.isArray(contextData)) {
				return [];
			}

			const dates = contextConfig.dateField
				? (getField(raw, contextConfig.dateField) as string[] | undefined)
				: undefined;

			for (let i = 0; i < contextData.length; i++) {
				const item = contextData[i];
				const date = dates?.[i];

				const content = formatContextItem(item, contextConfig.itemSchema, date, ingestion?.preprocessing?.formatTemplate);

				contexts.push({
					id: `context-${i}`,
					content,
					metadata: {
						index: i,
						date,
					},
				});
			}
			break;
		}

		case "object": {
			// Object with session keys (e.g., LoCoMo conversation)
			if (typeof contextData !== "object" || contextData === null) {
				return [];
			}

			const sessions = contextData as Record<string, unknown>;
			const sessionPattern = contextConfig.sessionPattern;
			const datePattern = contextConfig.datePattern;

			let sessionIndex = 0;
			for (const [key, value] of Object.entries(sessions)) {
				// Check if this is a session key
				if (sessionPattern && !matchesPattern(key, sessionPattern)) {
					continue;
				}

				// Check if this is a date key
				if (datePattern && matchesPattern(key, datePattern)) {
					continue;
				}

				// Get corresponding date if pattern is defined
				let date: string | undefined;
				if (datePattern) {
					const dateKey = key.replace(/session_(\d+)/, "session_$1_date_time");
					date = sessions[dateKey] as string | undefined;
				}

				const content = formatContextItem(value, contextConfig.itemSchema, date, ingestion?.preprocessing?.formatTemplate);

				contexts.push({
					id: `session-${sessionIndex}`,
					content,
					metadata: {
						sessionKey: key,
						date,
					},
				});

				sessionIndex++;
			}
			break;
		}

		case "string": {
			// Single string context
			contexts.push({
				id: "context-0",
				content: String(contextData),
				metadata: {},
			});
			break;
		}
	}

	return contexts;
}

/**
 * Format a context item into a string.
 */
function formatContextItem(
	item: unknown,
	itemSchema?: {
		content?: string;
		role?: string;
		speaker?: string;
		text?: string;
		dialogId?: string;
	},
	date?: string,
	formatTemplate?: string,
): string {
	if (typeof item === "string") {
		return date ? `[${date}] ${item}` : item;
	}

	if (Array.isArray(item)) {
		// Array of turns/messages
		const turns = item.map((turn) => {
			if (typeof turn === "string") {
				return turn;
			}
			const t = turn as Record<string, unknown>;
			const speaker = t.speaker ?? t.role ?? "";
			const text = t.text ?? t.content ?? "";
			return speaker ? `${speaker}: ${text}` : String(text);
		});

		const content = turns.join("\n");
		return date ? `[${date}]\n${content}` : content;
	}

	if (typeof item === "object" && item !== null) {
		// Single structured item
		const obj = item as Record<string, unknown>;

		if (itemSchema?.content) {
			const content = JSONPath({
				path: itemSchema.content,
				json: obj,
				wrap: false,
			});
			return String(content ?? JSON.stringify(obj));
		}

		return JSON.stringify(obj);
	}

	return String(item);
}

/**
 * Get a field value from an object using dot notation or JSONPath.
 */
function getField(obj: Record<string, unknown>, path: string): unknown {
	if (path.startsWith("$.")) {
		// JSONPath
		return JSONPath({ path, json: obj, wrap: false });
	}

	// Dot notation
	const parts = path.split(".");
	let current: unknown = obj;

	for (const part of parts) {
		if (current === null || current === undefined) {
			return undefined;
		}
		current = (current as Record<string, unknown>)[part];
	}

	return current;
}

/**
 * Check if a string matches a pattern with wildcards.
 */
function matchesPattern(str: string, pattern: string): boolean {
	const regex = new RegExp(
		"^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
	);
	return regex.test(str);
}

/**
 * Prepare contexts from benchmark items for ingestion into a provider.
 */
export function prepareBenchmarkContexts(
	items: BenchmarkItem[],
	config: BenchmarkConfig,
): PreparedData[] {
	const allContexts: PreparedData[] = [];
	const seenIds = new Set<string>();

	for (const item of items) {
		for (const context of item.contexts) {
			// Deduplicate contexts by ID
			if (seenIds.has(context.id)) {
				continue;
			}
			seenIds.add(context.id);

			allContexts.push({
				...context,
				metadata: {
					...context.metadata,
					benchmarkItemId: item.id,
					benchmarkName: config.name,
				},
			});
		}
	}

	return allContexts;
}

