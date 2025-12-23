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
 * - ndcg_at_5, ndcg_at_10 (Normalized Discounted Cumulative Gain)
 * - mrr (Mean Reciprocal Rank)
 * - precision_at_5, precision_at_10
 * - file_recall_at_5, file_recall_at_10 (file-level recall)
 * - file_mrr (file-level MRR)
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
export * from "./ndcg.ts";
export * from "./avg-retrieval-score.ts";
export * from "./latency.ts";
export * from "./success.ts";
export * from "./f1.ts";
export * from "./bleu.ts";
export * from "./rouge.ts";
export * from "./file-recall.ts";
export * from "./file-mrr.ts";
export * from "./iou.ts";

import { AccuracyMetric } from "./accuracy.ts";
import { AccuracyByQuestionTypeMetric } from "./accuracy-by-type.ts";
import { AccuracyByCategoryMetric } from "./accuracy-by-category.ts";
import { AbstentionAccuracyMetric } from "./abstention-accuracy.ts";
import { RecallAt1Metric, RecallAt3Metric, RecallAt5Metric, RecallAt10Metric } from "./recall.ts";
import { PrecisionAt1Metric, PrecisionAt3Metric, PrecisionAt5Metric, PrecisionAt10Metric } from "./precision.ts";
import { MRRMetric } from "./mrr.ts";
import { NDCGAt5Metric, NDCGAt10Metric } from "./ndcg.ts";
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
import { FileRecallAt5Metric, FileRecallAt10Metric } from "./file-recall.ts";
import { FileMRRMetric } from "./file-mrr.ts";
import { IoUAt1Metric, IoUAt3Metric, IoUAt5Metric, IoUAt10Metric } from "./iou.ts";
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
		SuccessAt5Metric,
		SuccessAt10Metric,
		// Context recall (strictest to loosest)
		RecallAt1Metric,
		RecallAt3Metric,
		RecallAt5Metric,
		RecallAt10Metric,

		// === Retrieval Metrics (for pure retrieval benchmarks) ===
		NDCGAt5Metric,
		NDCGAt10Metric,
		PrecisionAt1Metric,
		PrecisionAt3Metric,
		PrecisionAt5Metric,
		PrecisionAt10Metric,
		new MRRMetric(),
		new AvgRetrievalScoreMetric(),
		// File-level metrics (for SWE-bench style benchmarks)
		FileRecallAt5Metric,
		FileRecallAt10Metric,
		new FileMRRMetric(),

		// === Chunking Quality Metrics (for code chunking benchmarks) ===
		// IoU measures how precisely chunks align with ground truth line ranges
		IoUAt1Metric,
		IoUAt3Metric,
		IoUAt5Metric,
		IoUAt10Metric,

		// === Performance Metrics ===
		new AvgSearchLatencyMetric(),
		new AvgTotalLatencyMetric(),
		new P95LatencyMetric(),
	];
}
