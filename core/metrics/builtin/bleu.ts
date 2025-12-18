/**
 * BLEU-1 (Unigram Precision) metric calculator.
 *
 * Measures unigram overlap with clipping to avoid over-counting repeated words.
 *
 * Reference: Mem0, LoCoMo, BLEU paper (Papineni et al., 2002)
 */

import type { EvalResult } from "../../config.ts";
import type { MetricCalculator, MetricResult } from "../interface.ts";
import { tokenize, countTokens } from "./utils.ts";

/**
 * Compute BLEU-1 score with clipping.
 */
function computeBleu1(candidate: string[], reference: string[]): number {
	if (candidate.length === 0) return 0;

	const refCounts = countTokens(reference);
	let matches = 0;

	for (const token of candidate) {
		const count = refCounts.get(token) ?? 0;
		if (count > 0) {
			matches++;
			refCounts.set(token, count - 1);
		}
	}

	return matches / candidate.length;
}

/**
 * BLEU-1 (Unigram Precision) metric.
 */
export class Bleu1Metric implements MetricCalculator {
	readonly name = "bleu_1";
	readonly aliases = ["bleu1", "unigram_precision"] as const;
	readonly description = "BLEU-1 unigram precision";

	compute(results: EvalResult[]): MetricResult {
		if (results.length === 0) {
			return { name: this.name, value: 0 };
		}

		let totalBleu = 0;
		let evaluated = 0;

		for (const result of results) {
			const candidate = tokenize(result.actual);
			const reference = tokenize(result.expected);

			if (candidate.length === 0) continue;

			totalBleu += computeBleu1(candidate, reference);
			evaluated++;
		}

		return {
			name: this.name,
			value: evaluated > 0 ? totalBleu / evaluated : 0,
			details: {
				evaluated,
				skipped: results.length - evaluated,
			},
		};
	}
}
