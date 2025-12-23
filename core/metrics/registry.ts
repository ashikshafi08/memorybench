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

	register(calculator: MetricCalculator): void {
		this.registerItem(calculator.name, calculator, calculator.aliases);
	}

	override get(nameOrAlias: string): MetricCalculator | undefined {
		return super.get(nameOrAlias);
	}

	getOrThrow(nameOrAlias: string): MetricCalculator {
		const calculator = this.get(nameOrAlias);
		if (!calculator) {
			throw new RegistryNotFoundError("MetricRegistry", nameOrAlias, this.keys());
		}
		return calculator;
	}

	compute(nameOrAlias: string, results: EvalResult[]): MetricResult {
		const calculator = this.getOrThrow(nameOrAlias);
		return calculator.compute(results);
	}

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

	validateMetrics(metricNames: string[]): void {
		for (const name of metricNames) {
			if (!this.has(name)) {
				throw new RegistryNotFoundError("MetricRegistry", name, this.keys());
			}
		}
	}

	listMetricNames(): string[] {
		return this.keys();
	}

	listCalculators(): MetricCalculator[] {
		return this.list();
	}
}
