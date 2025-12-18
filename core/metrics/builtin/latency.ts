/**
 * Latency metric calculators.
 * These metrics use the telemetry data captured during evaluation.
 */

import type { EvalResult } from "../../config.ts";
import { extractTelemetry } from "../../telemetry.ts";
import type { MetricCalculator, MetricResult } from "../interface.ts";

/**
 * Average search latency metric (p50).
 */
export class AvgSearchLatencyMetric implements MetricCalculator {
	readonly name = "avg_search_latency_ms";
	readonly aliases = ["search_latency"] as const;
	readonly description = "Average search/retrieval latency in milliseconds";

	compute(results: EvalResult[]): MetricResult {
		const latencies: number[] = [];

		for (const result of results) {
			const telemetry = extractTelemetry(result.metadata);
			if (telemetry?.searchLatencyMs !== undefined) {
				latencies.push(telemetry.searchLatencyMs);
			}
		}

		if (latencies.length === 0) {
			return {
				name: this.name,
				value: 0,
				details: { measured: 0, total: results.length },
			};
		}

		const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

		return {
			name: this.name,
			value: avg,
			details: {
				measured: latencies.length,
				total: results.length,
				min: Math.min(...latencies),
				max: Math.max(...latencies),
			},
		};
	}
}

/**
 * Average total latency metric (end-to-end per item).
 */
export class AvgTotalLatencyMetric implements MetricCalculator {
	readonly name = "avg_total_latency_ms";
	readonly aliases = ["total_latency", "e2e_latency"] as const;
	readonly description =
		"Average end-to-end latency per item in milliseconds";

	compute(results: EvalResult[]): MetricResult {
		const latencies: number[] = [];

		for (const result of results) {
			const telemetry = extractTelemetry(result.metadata);
			if (telemetry?.totalLatencyMs !== undefined) {
				latencies.push(telemetry.totalLatencyMs);
			}
		}

		if (latencies.length === 0) {
			return {
				name: this.name,
				value: 0,
				details: { measured: 0, total: results.length },
			};
		}

		const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

		// Calculate percentiles
		const sorted = latencies.slice().sort((a, b) => a - b);
		const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
		const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
		const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;

		return {
			name: this.name,
			value: avg,
			details: {
				measured: latencies.length,
				total: results.length,
				min: Math.min(...latencies),
				max: Math.max(...latencies),
				p50,
				p95,
				p99,
			},
		};
	}
}

/**
 * P95 total latency metric.
 */
export class P95LatencyMetric implements MetricCalculator {
	readonly name = "p95_latency_ms";
	readonly aliases = ["latency_p95"] as const;
	readonly description = "95th percentile total latency in milliseconds";

	compute(results: EvalResult[]): MetricResult {
		const latencies: number[] = [];

		for (const result of results) {
			const telemetry = extractTelemetry(result.metadata);
			if (telemetry?.totalLatencyMs !== undefined) {
				latencies.push(telemetry.totalLatencyMs);
			}
		}

		if (latencies.length === 0) {
			return {
				name: this.name,
				value: 0,
				details: { measured: 0, total: results.length },
			};
		}

		const sorted = latencies.slice().sort((a, b) => a - b);
		const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;

		return {
			name: this.name,
			value: p95,
			details: {
				measured: latencies.length,
				total: results.length,
			},
		};
	}
}
