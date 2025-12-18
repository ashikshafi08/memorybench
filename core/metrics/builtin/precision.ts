/**
 * Precision@K metric calculators.
 * Measures what fraction of retrieved items are relevant.
 */

import type { EvalResult } from "../../config.ts";
import type { MetricCalculator, MetricResult } from "../interface.ts";
import { tokenize, computeF1FromPR } from "./utils.ts";

/**
 * Generic Precision@K metric calculator.
 * 
 * Uses token-based F1 scoring to determine relevance, avoiding the brittleness
 * of exact substring matching. A retrieved chunk is considered relevant if its
 * token-level F1 score with the expected answer exceeds a threshold.
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

		let totalPrecision = 0;
		let totalRelevant = 0;
		let totalRetrieved = 0;

		for (const result of results) {
			const retrievedContext = result.retrievedContext.slice(0, this.k);
			const expectedTokens = tokenize(result.expected);

			if (retrievedContext.length === 0) {
				continue;
			}

			// Count how many retrieved contexts are relevant using token-based F1
			const relevantCount = retrievedContext.filter((ctx) => {
				const chunkTokens = tokenize(ctx.content);
				const expectedSet = new Set(expectedTokens);
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

			totalPrecision += relevantCount / retrievedContext.length;
			totalRelevant += relevantCount;
			totalRetrieved += retrievedContext.length;
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
			},
		};
	}
}

// Pre-built instances for common K values
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
