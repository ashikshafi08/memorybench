/**
 * ROUGE-L (Longest Common Subsequence) metric calculator.
 *
 * Measures sentence-level structure similarity via LCS.
 *
 * Reference: LoCoMo, ROUGE paper (Lin, 2004)
 */

import type { EvalResult } from "../../config.ts";
import type { MetricCalculator, MetricResult } from "../interface.ts";
import { tokenize, lcsLength, computeF1FromPR } from "./utils.ts";

/**
 * ROUGE-L (Longest Common Subsequence) metric.
 */
export class RougeLMetric implements MetricCalculator {
	readonly name = "rouge_l";
	readonly aliases = ["rougeL", "lcs_f1"] as const;
	readonly description = "ROUGE-L F1 score based on LCS";

	compute(results: EvalResult[]): MetricResult {
		if (results.length === 0) {
			return { name: this.name, value: 0 };
		}

		let totalF1 = 0;
		let totalPrecision = 0;
		let totalRecall = 0;

		for (const result of results) {
			const candidate = tokenize(result.actual);
			const reference = tokenize(result.expected);

			if (candidate.length === 0 && reference.length === 0) {
				totalF1 += 1;
				totalPrecision += 1;
				totalRecall += 1;
				continue;
			}
			if (candidate.length === 0 || reference.length === 0) {
				continue;
			}

			const lcs = lcsLength(candidate, reference);
			const precision = lcs / candidate.length;
			const recall = lcs / reference.length;
			const f1 = computeF1FromPR(precision, recall);

			totalF1 += f1;
			totalPrecision += precision;
			totalRecall += recall;
		}

		return {
			name: this.name,
			value: totalF1 / results.length,
			details: {
				avgPrecision: totalPrecision / results.length,
				avgRecall: totalRecall / results.length,
				count: results.length,
			},
		};
	}
}
