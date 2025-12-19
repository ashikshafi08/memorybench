/**
 * Built-in metric calculators.
 * These are registered by default in the global metric registry.
 *
 * Metrics are organized into categories:
 *
 * ## Memory Metrics (recommended for memory benchmarks)
 * - accuracy, accuracy_by_question_type, accuracy_by_category
 * - f1, bleu_1, rouge_l
 * - success_at_5, success_at_10
 * - recall_at_5, recall_at_10
 *
 * ## Retrieval Metrics (for pure retrieval benchmarks)
 * - mrr (Mean Reciprocal Rank)
 * - precision_at_5, precision_at_10
 *
 * ## Performance Metrics
 * - avg_search_latency_ms, avg_total_latency_ms, p95_latency_ms
 */

export * from "./utils.ts";
export * from "./accuracy.ts";
export * from "./accuracy-by-type.ts";
export * from "./accuracy-by-category.ts";
export * from "./abstention-accuracy.ts";
export * from "./recall.ts";
export * from "./precision.ts";
export * from "./mrr.ts";
export * from "./avg-retrieval-score.ts";
export * from "./latency.ts";
export * from "./success.ts";
export * from "./f1.ts";
export * from "./bleu.ts";
export * from "./rouge.ts";

import { AccuracyMetric } from "./accuracy.ts";
import { AccuracyByQuestionTypeMetric } from "./accuracy-by-type.ts";
import { AccuracyByCategoryMetric } from "./accuracy-by-category.ts";
import { AbstentionAccuracyMetric } from "./abstention-accuracy.ts";
import { RecallAt5Metric, RecallAt10Metric } from "./recall.ts";
import { PrecisionAt5Metric, PrecisionAt10Metric } from "./precision.ts";
import { MRRMetric } from "./mrr.ts";
import { AvgRetrievalScoreMetric } from "./avg-retrieval-score.ts";
import {
	AvgSearchLatencyMetric,
	AvgTotalLatencyMetric,
	P95LatencyMetric,
} from "./latency.ts";
import { SuccessAt5Metric, SuccessAt10Metric } from "./success.ts";
import { F1Metric } from "./f1.ts";
import { Bleu1Metric } from "./bleu.ts";
import { RougeLMetric } from "./rouge.ts";
import type { MetricCalculator } from "../interface.ts";

/**
 * Get all built-in metric calculators.
 */
export function getBuiltinMetrics(): MetricCalculator[] {
	return [
		// === Memory Metrics (recommended for memory benchmarks) ===
		// Answer quality metrics
		new AccuracyMetric(),
		new AccuracyByQuestionTypeMetric(),
		new AccuracyByCategoryMetric(),
		new AbstentionAccuracyMetric(),
		new F1Metric(),
		new Bleu1Metric(),
		new RougeLMetric(),
		// End-to-end retrieval success
		new SuccessAt5Metric(),
		new SuccessAt10Metric(),
		// Context recall
		new RecallAt5Metric(),
		new RecallAt10Metric(),

		// === Retrieval Metrics (for pure retrieval benchmarks) ===
		new PrecisionAt5Metric(),
		new PrecisionAt10Metric(),
		new MRRMetric(),
		new AvgRetrievalScoreMetric(),

		// === Performance Metrics ===
		new AvgSearchLatencyMetric(),
		new AvgTotalLatencyMetric(),
		new P95LatencyMetric(),
	];
}
