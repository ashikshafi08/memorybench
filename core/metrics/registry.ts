/**
 * Metric Registry - central registry for metric calculators.
 * Inspired by OpenBench's pluggable metric pattern.
 */

import type { EvalResult } from "../config.ts";
import type { MetricCalculator, MetricResult } from "./interface.ts";

/**
 * Error thrown when an unknown metric is requested.
 */
export class UnknownMetricError extends Error {
	constructor(
		public readonly requestedMetric: string,
		public readonly availableMetrics: string[],
	) {
		super(
			`Unknown metric "${requestedMetric}". Available: ${availableMetrics.join(", ")}`,
		);
		this.name = "UnknownMetricError";
	}
}

/**
 * Central registry for metric calculators.
 * Supports registration by name and aliases, and batch computation.
 */
export class MetricRegistry {
	private calculators = new Map<string, MetricCalculator>();
	private aliasMap = new Map<string, string>(); // alias -> primary name

	/**
	 * Register a metric calculator.
	 * @param calculator - The metric calculator to register
	 * @throws Error if the metric name or any alias is already registered
	 */
	register(calculator: MetricCalculator): void {
		const { name, aliases = [] } = calculator;

		// Check for conflicts
		if (this.calculators.has(name) || this.aliasMap.has(name)) {
			throw new Error(`Metric "${name}" is already registered`);
		}

		for (const alias of aliases) {
			if (this.calculators.has(alias) || this.aliasMap.has(alias)) {
				throw new Error(
					`Metric alias "${alias}" conflicts with existing metric`,
				);
			}
		}

		// Register the calculator
		this.calculators.set(name, calculator);

		// Register aliases
		for (const alias of aliases) {
			this.aliasMap.set(alias, name);
		}
	}

	/**
	 * Check if a metric (by name or alias) is registered.
	 */
	has(nameOrAlias: string): boolean {
		return (
			this.calculators.has(nameOrAlias) || this.aliasMap.has(nameOrAlias)
		);
	}

	/**
	 * Get a metric calculator by name or alias.
	 * @param nameOrAlias - Metric name or alias
	 * @throws UnknownMetricError if the metric is not registered
	 */
	get(nameOrAlias: string): MetricCalculator {
		// Direct lookup
		if (this.calculators.has(nameOrAlias)) {
			return this.calculators.get(nameOrAlias)!;
		}

		// Alias lookup
		const primaryName = this.aliasMap.get(nameOrAlias);
		if (primaryName && this.calculators.has(primaryName)) {
			return this.calculators.get(primaryName)!;
		}

		throw new UnknownMetricError(nameOrAlias, this.listMetricNames());
	}

	/**
	 * Compute a single metric.
	 * @param nameOrAlias - Metric name or alias
	 * @param results - Evaluation results
	 * @throws UnknownMetricError if the metric is not registered
	 */
	compute(nameOrAlias: string, results: EvalResult[]): MetricResult {
		const calculator = this.get(nameOrAlias);
		return calculator.compute(results);
	}

	/**
	 * Compute multiple metrics.
	 * @param metricNames - List of metric names/aliases to compute
	 * @param results - Evaluation results
	 * @throws UnknownMetricError if any metric is not registered
	 */
	computeAll(metricNames: string[], results: EvalResult[]): MetricResult[] {
		// Validate all metrics exist before computing any
		this.validateMetrics(metricNames);

		// Compute each metric
		const computed: MetricResult[] = [];
		const seen = new Set<string>(); // Avoid duplicates if same metric requested via name and alias

		for (const nameOrAlias of metricNames) {
			const calculator = this.get(nameOrAlias);

			// Skip if already computed (via alias or name)
			if (seen.has(calculator.name)) {
				continue;
			}
			seen.add(calculator.name);

			computed.push(calculator.compute(results));
		}

		return computed;
	}

	/**
	 * Validate that all metric names exist.
	 * @throws UnknownMetricError if any metric is not registered
	 */
	validateMetrics(metricNames: string[]): void {
		for (const name of metricNames) {
			if (!this.has(name)) {
				throw new UnknownMetricError(name, this.listMetricNames());
			}
		}
	}

	/**
	 * List all registered metric names (primary names only, no aliases).
	 */
	listMetricNames(): string[] {
		return Array.from(this.calculators.keys()).sort();
	}

	/**
	 * List all registered calculators.
	 */
	listCalculators(): MetricCalculator[] {
		return Array.from(this.calculators.values());
	}

	/**
	 * Get the total count of registered metrics.
	 */
	get size(): number {
		return this.calculators.size;
	}
}
