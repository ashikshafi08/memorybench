/**
 * Recall@K metric calculators.
 * Measures what fraction of relevant items are retrieved in top K.
 */

import type { EvalResult } from "../../config.ts";
import type { MetricCalculator, MetricResult } from "../interface.ts";

/**
 * Generic Recall@K metric calculator.
 */
export class RecallAtKMetric implements MetricCalculator {
	readonly name: string;
	readonly aliases: readonly string[];
	readonly description: string;
	private readonly k: number;

	constructor(k: number) {
		this.k = k;
		this.name = `recall_at_${k}`;
		this.aliases = [`recall@${k}`, `r@${k}`] as const;
		this.description = `Recall at top ${k} retrieved results`;
	}

	compute(results: EvalResult[]): MetricResult {
		if (results.length === 0) {
			return { name: this.name, value: 0 };
		}

		let totalRecall = 0;

		for (const result of results) {
			const retrievedContext = result.retrievedContext.slice(0, this.k);
			const expected = result.expected.toLowerCase();

			// Check if any retrieved context contains the expected answer
			const hasRelevant = retrievedContext.some((ctx) =>
				ctx.content.toLowerCase().includes(expected),
			);

			if (hasRelevant) {
				totalRecall++;
			}
		}

		return {
			name: this.name,
			value: totalRecall / results.length,
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
