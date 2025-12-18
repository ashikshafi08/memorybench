/**
 * Legacy template types for backwards compatibility.
 *
 * @deprecated Use the new adapter system in providers/adapters/ and types from core/config.ts.
 *
 * New providers should:
 * 1. Create a YAML config in providers/configs/
 * 2. Implement a TypeScript adapter extending LocalProvider (providers/base/local-provider.ts)
 * 3. Register the adapter in providers/factory.ts
 *
 * See providers/adapters/aqrag.ts for an example.
 */

import type { BenchmarkRegistry, BenchmarkType } from "../../benchmarks";

const mockSearchFunction = async (_query: string) => {
	return [
		{
			id: "",
			context: "",
			score: 0,
		},
	];
};

/**
 * @deprecated Use PreparedData from core/config.ts instead.
 * Note: The new PreparedData uses `content` instead of `context`.
 */
export interface PreparedData {
	context: string;
	metadata: Record<string, unknown>;
}

export type BenchmarkProcessor<T extends BenchmarkType> = (
	data: BenchmarkRegistry[T][],
) => PreparedData[];

export type BenchmarkProcessors = {
	[K in BenchmarkType]?: BenchmarkProcessor<K>;
};

/**
 * @deprecated Use LocalProvider from providers/base/local-provider.ts instead.
 */
const templateType = {
	name: "Template repository",
	addContext: async (data: PreparedData) => {
		// process context with full type safety
		console.log(data.context); // string
		console.log(data.metadata); // Record<string, unknown>
	},

	searchQuery: async (query: string) => {
		return mockSearchFunction(query);
	},

	prepareProvider: <T extends BenchmarkType>(
		benchmarkType: T,
		data: BenchmarkRegistry[T][],
	): PreparedData[] => {
		const processors: BenchmarkProcessors = {
			RAG: (ragData: BenchmarkRegistry["RAG"][]) => {
				return ragData.map((item) => ({
					context: `Question: ${item.question}\n\nDocuments:\n${item.documents.map((d: { id: string; content: string; title?: string }) => `- ${d.title}: ${d.content}`).join("\n")}`,
					metadata: {
						id: item.id,
						expectedAnswer: item.expected_answer,
						difficulty: item.metadata.difficulty,
						category: item.metadata.category,
					},
				}));
			},
		};

		const processor = processors[benchmarkType] as
			| BenchmarkProcessor<T>
			| undefined;
		if (!processor) {
			throw new Error(
				`Benchmark type "${benchmarkType}" not supported by this provider`,
			);
		}

		return processor(data);
	},
};

export type TemplateType = typeof templateType;
