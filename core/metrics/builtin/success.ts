/**
 * Success@K (Semantic Hit@K) metric calculators.
 *
 * Binary metric measuring end-to-end retrieval success for memory benchmarks.
 *
 * Definition:
 *   Success@K = 1 if BOTH conditions are met:
 *     1. Answer is correct (LLM judge / EM / F1 threshold)
 *     2. At least one chunk in top-K is semantically relevant to the expected answer
 *
 * Reference: Memory benchmark best practices (LongMemEval, LoCoMo, Mem0)
 */

import type { EvalResult } from "../../config.ts";
import type { MetricCalculator, MetricResult } from "../interface.ts";
import { tokenize, computeF1FromPR } from "./utils.ts";

/**
 * Generic Success@K metric calculator.
 */
export class SuccessAtKMetric implements MetricCalculator {
	readonly name: string;
	readonly aliases: readonly string[];
	readonly description: string;
	private readonly k: number;
	private readonly f1Threshold: number;

	constructor(k: number, f1Threshold = 0.1) {
		this.k = k;
		this.f1Threshold = f1Threshold;
		this.name = `success_at_${k}`;
		this.aliases = [`success@${k}`, `hit@${k}`] as const;
		this.description = `Success@${k}: correct answer with relevant retrieval in top ${k}`;
	}

	compute(results: EvalResult[]): MetricResult {
		if (results.length === 0) {
			return { name: this.name, value: 0 };
		}

		let successes = 0;
		let correctButNoRelevant = 0;
		let incorrectWithRelevant = 0;

		for (const result of results) {
			const isCorrect = result.correct;
			const expectedTokens = tokenize(result.expected);
			const topK = result.retrievedContext.slice(0, this.k);

			const hasRelevantChunk = topK.some((ctx) => {
				const chunkTokens = tokenize(ctx.content);
				const expectedSet = new Set(expectedTokens);
				const chunkSet = new Set(chunkTokens);

				let overlap = 0;
				for (const t of expectedSet) {
					if (chunkSet.has(t)) overlap++;
				}

				const precision = chunkSet.size > 0 ? overlap / chunkSet.size : 0;
				const recall = expectedSet.size > 0 ? overlap / expectedSet.size : 0;
				return computeF1FromPR(precision, recall) >= this.f1Threshold;
			});

			if (isCorrect && hasRelevantChunk) {
				successes++;
			} else if (isCorrect && !hasRelevantChunk) {
				correctButNoRelevant++;
			} else if (!isCorrect && hasRelevantChunk) {
				incorrectWithRelevant++;
			}
		}

		return {
			name: this.name,
			value: successes / results.length,
			details: {
				successes,
				total: results.length,
				correctButNoRelevant,
				incorrectWithRelevant,
				k: this.k,
				f1Threshold: this.f1Threshold,
			},
		};
	}
}

export const SuccessAt5Metric = new SuccessAtKMetric(5);
export const SuccessAt10Metric = new SuccessAtKMetric(10);
