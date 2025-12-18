/**
 * Precision@K metric calculators.
 * Measures what fraction of retrieved items are relevant.
 */

import type { EvalResult } from "../../config.ts";
import type { MetricCalculator, MetricResult } from "../interface.ts";

/**
 * Generic Precision@K metric calculator.
 */
export class PrecisionAtKMetric implements MetricCalculator {
	readonly name: string;
	readonly aliases: readonly string[];
	readonly description: string;
	private readonly k: number;

	constructor(k: number) {
		this.k = k;
		this.name = `precision_at_${k}`;
		this.aliases = [`precision@${k}`, `p@${k}`] as const;
		this.description = `Precision at top ${k} retrieved results`;
	}

	compute(results: EvalResult[]): MetricResult {
		if (results.length === 0) {
			return { name: this.name, value: 0 };
		}

		let totalPrecision = 0;

		for (const result of results) {
			const retrievedContext = result.retrievedContext.slice(0, this.k);
			const expected = result.expected.toLowerCase();

			if (retrievedContext.length === 0) {
				continue;
			}

			// Count how many retrieved contexts are relevant
			const relevantCount = retrievedContext.filter((ctx) =>
				ctx.content.toLowerCase().includes(expected),
			).length;

			totalPrecision += relevantCount / retrievedContext.length;
		}

		return {
			name: this.name,
			value: totalPrecision / results.length,
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
