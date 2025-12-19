/**
 * Recall@K metric calculators.
 * Measures what fraction of relevant items are retrieved in top K.
 */

import type { EvalResult } from "../../config.ts";
import type { MetricCalculator, MetricResult } from "../interface.ts";
import { tokenize } from "./utils.ts";
import { getPackRegistry } from "../../../benchmarks/packs/index.ts";

/**
 * Generic Recall@K metric calculator.
 * 
 * Determines relevance by checking how much of the expected answer's token set
 * is covered by a retrieved chunk.
 *
 * Why not token-F1 against the entire chunk?
 * Many memory providers return very large "chunks" (e.g., full conversation
 * sessions). Token-F1 penalizes large chunks via very low precision, which can
 * incorrectly drive Recall@K to 0 even when the expected answer clearly appears
 * in the retrieved text. For Recall@K, what we care about is *coverage* of the
 * expected answer tokens (i.e., recall), not how compact the retrieved chunk is.
 * 
 * This approach handles:
 * - Minor wording differences ("Paris is capital of France" vs "Paris is the capital and most populous city of France")
 * - Punctuation variations
 * - Different phrasings that share key semantic tokens
 * 
 * @param k - Number of top results to consider
 * @param f1Threshold - Minimum expected-token coverage to count as relevant (default: 0.3)
 */
export class RecallAtKMetric implements MetricCalculator {
	readonly name: string;
	readonly aliases: readonly string[];
	readonly description: string;
	private readonly k: number;
	private readonly f1Threshold: number;

	constructor(k: number, f1Threshold = 0.3) {
		this.k = k;
		this.f1Threshold = f1Threshold;
		this.name = `recall_at_${k}`;
		this.aliases = [`recall@${k}`, `r@${k}`] as const;
		this.description = `Recall at top ${k} retrieved results`;
	}

	compute(results: EvalResult[]): MetricResult {
		if (results.length === 0) {
			return { name: this.name, value: 0 };
		}

		// Try to get pack for label-grounded relevance (if available)
		// Use first result to determine benchmark
		const firstResult = results[0]!;
		const benchmarkName = firstResult.benchmark;
		const packRegistry = getPackRegistry();
		const pack = packRegistry.getLatest(benchmarkName);

		let totalRecall = 0;
		let relevantFound = 0;
		let exactMatchFound = 0;
		let packRelevantFound = 0;

		for (const result of results) {
			const retrievedContext = result.retrievedContext.slice(0, this.k);
			
			// If pack exists and owns relevance semantics, use pack's isRelevant
			let hasRelevant = false;
			if (pack && pack.sealedSemantics.relevance) {
				// Reconstruct item from result metadata (best effort)
				const item = {
					id: result.itemId,
					question: result.question,
					answer: result.expected,
					contexts: [],
					metadata: result.metadata || {},
				} as import("../../config.ts").BenchmarkItem;
				
				hasRelevant = retrievedContext.some((ctx) => {
					const isRel = pack.isRelevant({
						item,
						result: ctx,
					});
					if (isRel) packRelevantFound++;
					return isRel;
				});
			} else {
				// Fallback to token-based relevance
				const expectedTokens = tokenize(result.expected);
				const expectedSet = new Set(expectedTokens);

				hasRelevant = retrievedContext.some((ctx) => {
					// Also check for exact match (for tracking)
					const exactMatch = ctx.content.toLowerCase().includes(result.expected.toLowerCase());
					if (exactMatch) exactMatchFound++;

					if (expectedSet.size === 0) {
						return true;
					}

					const chunkTokens = tokenize(ctx.content);
					const found = new Set<string>();
					for (const t of chunkTokens) {
						if (expectedSet.has(t)) {
							found.add(t);
							if (found.size === expectedSet.size) break;
						}
					}

					const coverage = found.size / expectedSet.size; // recall of expected tokens
					return coverage >= this.f1Threshold;
				});
			}

			if (hasRelevant) {
				totalRecall++;
				relevantFound++;
			}
		}

		return {
			name: this.name,
			value: totalRecall / results.length,
			details: {
				relevantFound,
				exactMatchFound,
				packRelevantFound: pack ? packRelevantFound : undefined,
				total: results.length,
				k: this.k,
				f1Threshold: this.f1Threshold,
				usesPackRelevance: pack?.sealedSemantics.relevance || false,
			},
		};
	}
}

// Pre-built instances for common K values
export class RecallAt5Metric extends RecallAtKMetric {
	constructor() {
		super(5);
	}
}

export class RecallAt10Metric extends RecallAtKMetric {
	constructor() {
		super(10);
	}
}
