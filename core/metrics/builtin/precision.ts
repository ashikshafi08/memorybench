/**
 * Precision@K metric calculators.
 * Measures what fraction of retrieved items are relevant.
 *
 * This implementation supports three relevance determination strategies:
 *
 * 1. **Explicit qrels** (recommended for code-chunk):
 *    Uses `result.metadata.relevantIds` or `relevantChunkIds` for ground-truth.
 *
 * 2. **Pack-owned relevance** (existing memorybench pattern):
 *    Uses pack's `isRelevant()` when `pack.sealedSemantics.relevance === true`.
 *
 * 3. **Token-based fallback**:
 *    Uses token overlap + F1 threshold when no labels exist.
 */

import type { EvalResult, BenchmarkItem, SearchResult } from "../../config.ts";
import type { MetricCalculator, MetricResult } from "../interface.ts";
import { tokenize, computeF1FromPR } from "./utils.ts";
import { getPackRegistry } from "../../../benchmarks/packs/index.ts";

/**
 * Generic Precision@K metric calculator.
 * 
 * Uses priority-based relevance: qrels > pack > token-fallback.
 * 
 * This approach handles:
 * - Minor wording differences
 * - Punctuation variations
 * - Different phrasings that share key semantic tokens
 * 
 * @param k - Number of top results to consider
 * @param f1Threshold - Minimum F1 score for a chunk to be considered relevant (default: 0.3)
 */
export class PrecisionAtKMetric implements MetricCalculator {
	readonly name: string;
	readonly aliases: readonly string[];
	readonly description: string;
	private readonly k: number;
	private readonly f1Threshold: number;

	constructor(k: number, f1Threshold = 0.3) {
		this.k = k;
		this.f1Threshold = f1Threshold;
		this.name = `precision_at_${k}`;
		this.aliases = [`precision@${k}`, `p@${k}`] as const;
		this.description = `Precision at top ${k} retrieved results`;
	}

	compute(results: EvalResult[]): MetricResult {
		if (results.length === 0) {
			return { name: this.name, value: 0 };
		}

		// Try to get pack for label-grounded relevance (if available)
		const firstResult = results[0]!;
		const benchmarkName = firstResult.benchmark;
		const packRegistry = getPackRegistry();
		const pack = packRegistry.getLatest(benchmarkName);

		let totalPrecision = 0;
		let totalRelevant = 0;
		let totalRetrieved = 0;
		let strategyUsed: "qrels" | "pack" | "token-fallback" | "mixed" = "token-fallback";
		const strategyCounts = { qrels: 0, pack: 0, "token-fallback": 0 };

		for (const result of results) {
			const retrievedContext = result.retrievedContext.slice(0, this.k);

			if (retrievedContext.length === 0) {
				continue;
			}

			// Count relevant items using priority-based strategy
			const { relevantCount, strategy } = this.countRelevant(result, retrievedContext, pack);
			strategyCounts[strategy]++;

			totalPrecision += relevantCount / retrievedContext.length;
			totalRelevant += relevantCount;
			totalRetrieved += retrievedContext.length;
		}

		// Determine predominant strategy
		if (strategyCounts.qrels > 0 && strategyCounts.pack === 0 && strategyCounts["token-fallback"] === 0) {
			strategyUsed = "qrels";
		} else if (strategyCounts.pack > 0 && strategyCounts.qrels === 0 && strategyCounts["token-fallback"] === 0) {
			strategyUsed = "pack";
		} else if (strategyCounts["token-fallback"] > 0 && strategyCounts.qrels === 0 && strategyCounts.pack === 0) {
			strategyUsed = "token-fallback";
		} else {
			strategyUsed = "mixed";
		}

		return {
			name: this.name,
			value: totalPrecision / results.length,
			details: {
				avgRelevantPerQuery: totalRelevant / results.length,
				avgRetrievedPerQuery: totalRetrieved / results.length,
				total: results.length,
				k: this.k,
				f1Threshold: this.f1Threshold,
				strategyUsed,
				strategyCounts,
			},
		};
	}

	/**
	 * Count relevant items using priority-based strategy.
	 */
	private countRelevant(
		result: EvalResult,
		retrievedContext: SearchResult[],
		pack: import("../../../benchmarks/packs/interface.ts").BenchmarkPack | undefined,
	): { relevantCount: number; strategy: "qrels" | "pack" | "token-fallback" } {
		// Strategy A: Explicit qrels in metadata
		const qrels = this.extractQrels(result);
		if (qrels !== null) {
			const relevantCount = retrievedContext.filter((ctx) => qrels.has(ctx.id)).length;
			return { relevantCount, strategy: "qrels" };
		}

		// Strategy B: Pack-owned relevance
		if (pack && pack.sealedSemantics.relevance) {
			// Reconstruct item from result metadata (best effort)
			const item: BenchmarkItem = {
				id: result.itemId,
				question: result.question,
				answer: result.expected,
				contexts: [],
				metadata: result.metadata || {},
			};

			const relevantCount = retrievedContext.filter((ctx) =>
				pack.isRelevant({ item, result: ctx }),
			).length;
			return { relevantCount, strategy: "pack" };
		}

		// Strategy C: Token-based F1 fallback
		const expectedTokens = tokenize(result.expected);
		const expectedSet = new Set(expectedTokens);

		const relevantCount = retrievedContext.filter((ctx) => {
			const chunkTokens = tokenize(ctx.content);
			const chunkSet = new Set(chunkTokens);

			// Compute token overlap
			let overlap = 0;
			for (const token of expectedSet) {
				if (chunkSet.has(token)) overlap++;
			}

			// Calculate F1 score for this chunk
			const precision = chunkSet.size > 0 ? overlap / chunkSet.size : 0;
			const recall = expectedSet.size > 0 ? overlap / expectedSet.size : 0;
			const f1 = computeF1FromPR(precision, recall);

			return f1 >= this.f1Threshold;
		}).length;

		return { relevantCount, strategy: "token-fallback" };
	}

	/**
	 * Extract qrels from result metadata if available.
	 */
	private extractQrels(result: EvalResult): Set<string> | null {
		const metadata = result.metadata;
		if (!metadata) return null;

		// Check common field names for qrels
		const qrelsField =
			metadata.relevantIds ??
			metadata.relevantChunkIds ??
			metadata.groundTruthIds ??
			metadata.qrels;

		if (Array.isArray(qrelsField)) {
			const ids = qrelsField
				.map((id) => String(id).trim())
				.filter((id) => id.length > 0);
			if (ids.length > 0) {
				return new Set(ids);
			}
		}

		return null;
	}
}

// Pre-built instances for common K values
export class PrecisionAt1Metric extends PrecisionAtKMetric {
	constructor() {
		super(1);
	}
}

export class PrecisionAt3Metric extends PrecisionAtKMetric {
	constructor() {
		super(3);
	}
}

export class PrecisionAt5Metric extends PrecisionAtKMetric {
	constructor() {
		super(5);
	}
}

export class PrecisionAt10Metric extends PrecisionAtKMetric {
	constructor() {
		super(10);
	}
}
