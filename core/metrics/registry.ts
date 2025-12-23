/**
 * Metric Registry - central registry for metric calculators.
 * Inspired by OpenBench's pluggable metric pattern.
 *
 * Now extends BaseRegistry for consistent registry behavior across the codebase.
 */

import type { EvalResult } from "../config.ts";
import type { MetricCalculator, MetricResult } from "./interface.ts";
import { BaseRegistry, RegistryNotFoundError } from "../registry/index.ts";

/**
 * Central registry for metric calculators.
 * Supports registration by name and aliases, and batch computation.
 *
 * Extends BaseRegistry for core registry operations (register, get, has, list).
 */
export class MetricRegistry extends BaseRegistry<MetricCalculator> {
	constructor() {
		super({ name: "MetricRegistry", throwOnConflict: true });
	}

	/**
	 * Register a metric calculator.
	 * @param calculator - The metric calculator to register
	 * @throws Error if the metric name or any alias is already registered
	 */
	register(calculator: MetricCalculator): void {
		this.registerItem(calculator.name, calculator, calculator.aliases);
	}

	/**
	 * Get a metric calculator by name or alias.
	 * Returns undefined if not found (consistent with base class).
	 * @param nameOrAlias - Metric name or alias
	 */
	override get(nameOrAlias: string): MetricCalculator | undefined {
		return super.get(nameOrAlias);
	}

	/**
	 * Get a metric calculator by name or alias, throwing if not found.
	 * Use this when you expect the metric to exist.
	 * @param nameOrAlias - Metric name or alias
	 * @throws RegistryNotFoundError if the metric is not registered
	 */
	getOrThrow(nameOrAlias: string): MetricCalculator {
		const calculator = this.get(nameOrAlias);
		if (!calculator) {
			throw new RegistryNotFoundError("MetricRegistry", nameOrAlias, this.keys());
		}
		return calculator;
	}

	/**
	 * Compute a single metric.
	 * @param nameOrAlias - Metric name or alias
	 * @param results - Evaluation results
	 * @throws RegistryNotFoundError if the metric is not registered
	 */
	compute(nameOrAlias: string, results: EvalResult[]): MetricResult {
		const calculator = this.getOrThrow(nameOrAlias);
		return calculator.compute(results);
	}

	/**
	 * Compute multiple metrics.
	 * @param metricNames - List of metric names/aliases to compute
	 * @param results - Evaluation results
	 * @throws RegistryNotFoundError if any metric is not registered
	 */
	computeAll(metricNames: string[], results: EvalResult[]): MetricResult[] {
		// Validate all metrics exist before computing any
		this.validateMetrics(metricNames);

		// Compute each metric
		const computed: MetricResult[] = [];
		const seen = new Set<string>(); // Avoid duplicates if same metric requested via name and alias

		for (const nameOrAlias of metricNames) {
			const calculator = this.getOrThrow(nameOrAlias);

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
	 * @throws RegistryNotFoundError if any metric is not registered
	 */
	validateMetrics(metricNames: string[]): void {
		for (const name of metricNames) {
			if (!this.has(name)) {
				throw new RegistryNotFoundError("MetricRegistry", name, this.keys());
			}
		}
	}

	/**
	 * List all registered metric names (primary names only, no aliases).
	 */
	listMetricNames(): string[] {
		return this.keys();
	}

	/**
	 * List all registered calculators.
	 */
	listCalculators(): MetricCalculator[] {
		return this.list();
	}
}
