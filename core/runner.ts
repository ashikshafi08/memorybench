/**
 * Benchmark runner that executes benchmarks with concurrency and checkpointing.
 */

import pLimit from "p-limit";
import type { Registry } from "./registry.ts";
import type { CheckpointManager } from "./checkpoint.ts";
import type { BenchmarkConfig, BenchmarkItem, PreparedData, SearchResult, EvalResult } from "./config.ts";
import type { Provider } from "../providers/base/types.ts";
import { createProvider } from "../providers/factory.ts";
import { loadBenchmarkData, prepareBenchmarkContexts } from "../benchmarks/loaders/index.ts";
import { getDefaultRegistry, UnknownMetricError } from "./metrics/index.ts";
import type { MetricResult } from "./metrics/interface.ts";
import { measureLatency, addTelemetryToMetadata, type ItemTelemetry } from "./telemetry.ts";
import { evaluate as evaluateWithLLM, type EvaluationResult } from "../benchmarks/evaluators/llm-judge.ts";

export interface RunOptions {
	benchmarks: string[];
	providers: string[];
	limit?: number;
	start?: number;
	end?: number;
	questionType?: string;
	concurrency?: number;
	runId?: string;
	resume?: boolean;
	outputDir?: string;
	/**
	 * Metrics to compute. If provided, overrides benchmark YAML config.
	 * Falls back to benchmark YAML `metrics:` if not specified, then to ["accuracy"].
	 */
	metrics?: string[];
}

export interface RunResult {
	runId: string;
	startedAt: string;
	completedAt?: string;
	benchmarks: string[];
	providers: string[];
	results: BenchmarkProviderResult[];
	summary: RunSummary;
}

export interface BenchmarkProviderResult {
	benchmark: string;
	provider: string;
	totalItems: number;
	completedItems: number;
	failedItems: number;
	/** @deprecated Use metrics array instead. Kept for backward compatibility. */
	accuracy: number;
	/** Computed metrics from the registry */
	metrics: import("./metrics/interface.ts").MetricResult[];
	results: EvalResult[];
}

export interface RunSummary {
	totalBenchmarks: number;
	totalProviders: number;
	totalItems: number;
	completedItems: number;
	failedItems: number;
	overallAccuracy: number;
}

export type ProgressCallback = (progress: {
	benchmark: string;
	provider: string;
	current: number;
	total: number;
	phase: "ingest" | "search" | "evaluate";
	currentAccuracy?: number;
}) => void;

export class BenchmarkRunner {
	private registry: Registry;
	private checkpointManager: CheckpointManager;
	private onProgress?: ProgressCallback;

	constructor(
		registry: Registry,
		checkpointManager: CheckpointManager,
		options?: {
			onProgress?: ProgressCallback;
		},
	) {
		this.registry = registry;
		this.checkpointManager = checkpointManager;
		this.onProgress = options?.onProgress;
	}

	/**
	 * Run benchmarks against providers.
	 */
	async run(options: RunOptions): Promise<RunResult> {
		const runId = options.runId ?? this.generateRunId();
		// Expose runId for debug instrumentation (best-effort)
		process.env.MEMORYBENCH_RUN_ID = runId;
		const concurrency = options.concurrency ?? 10;
		const limit = pLimit(concurrency);

		const startedAt = new Date().toISOString();
		const results: BenchmarkProviderResult[] = [];

		// Process each benchmark/provider combination
		const tasks: Promise<BenchmarkProviderResult>[] = [];

		for (const benchmarkName of options.benchmarks) {
			const benchmarkConfig = this.registry.getBenchmark(benchmarkName);

			for (const providerName of options.providers) {
				const providerConfig = this.registry.getProvider(providerName);

				tasks.push(
					limit(() =>
						this.runSingle({
							runId,
							benchmarkConfig,
							providerConfig: providerConfig,
							providerName,
							options,
						}),
					),
				);
			}
		}

		const batchResults = await Promise.all(tasks);
		results.push(...batchResults);

		// Calculate summary
		const summary = this.calculateSummary(results);

		return {
			runId,
			startedAt,
			completedAt: new Date().toISOString(),
			benchmarks: options.benchmarks,
			providers: options.providers,
			results,
			summary,
		};
	}

	/**
	 * Run a single benchmark/provider combination.
	 */
	private async runSingle(params: {
		runId: string;
		benchmarkConfig: BenchmarkConfig;
		providerConfig: import("./config.ts").ProviderConfig;
		providerName: string;
		options: RunOptions;
	}): Promise<BenchmarkProviderResult> {
		const { runId, benchmarkConfig, providerConfig, providerName, options } =
			params;
		const benchmarkName = benchmarkConfig.name;

		// Create provider
		const provider = await createProvider(providerConfig);
		if (provider.initialize) {
			await provider.initialize();
		}

		try {
			// Load benchmark data
			const items = await loadBenchmarkData(benchmarkConfig, {
				limit: options.limit,
				start: options.start,
				end: options.end,
				questionType: options.questionType,
			});

			// Generate run tag for scoping
			const runTag = this.formatRunTag(
				benchmarkConfig,
				providerConfig,
				runId,
			);

			// Load or create checkpoint
			await this.checkpointManager.loadOrCreate(
				runId,
				benchmarkName,
				providerName,
				{
					questionType: options.questionType,
					startPosition: options.start,
					endPosition: options.end,
				},
			);

			// Ingestion phase
			await this.ingestPhase(
				provider,
				items,
				benchmarkConfig,
				runId,
				runTag,
				providerName,
			);

			// Search & Evaluate phase
			const evalResults = await this.evaluatePhase(
				provider,
				items,
				benchmarkConfig,
				runId,
				runTag,
				providerName,
			);

			// Cleanup
			try {
				await provider.clear(runTag);
			} catch (error) {
				console.warn(`Failed to clear provider data: ${error}`);
			}

			// Determine which metrics to compute
			// Priority: CLI override > benchmark YAML > default ["accuracy"]
			const metricsToCompute =
				options.metrics ??
				benchmarkConfig.metrics ??
				["accuracy"];

			// Compute metrics using the registry
			const registry = getDefaultRegistry();

			// Validate all metrics exist (fail fast)
			registry.validateMetrics(metricsToCompute);

			const computedMetrics = registry.computeAll(metricsToCompute, evalResults);

			// Extract accuracy for backward compatibility
			const accuracyMetric = computedMetrics.find((m) => m.name === "accuracy");
			const accuracy = accuracyMetric?.value ?? (
				evalResults.length > 0
					? evalResults.filter((r) => r.correct).length / evalResults.length
					: 0
			);

			return {
				benchmark: benchmarkName,
				provider: providerName,
				totalItems: items.length,
				completedItems: evalResults.length,
				failedItems: items.length - evalResults.length,
				accuracy,
				metrics: computedMetrics,
				results: evalResults,
			};
		} finally {
			if (provider.cleanup) {
				await provider.cleanup();
			}
		}
	}

	/**
	 * Ingestion phase - add contexts to provider.
	 */
	private async ingestPhase(
		provider: Provider,
		items: BenchmarkItem[],
		benchmarkConfig: BenchmarkConfig,
		runId: string,
		runTag: string,
		providerName: string,
	): Promise<void> {
		const benchmarkName = benchmarkConfig.name;

		// Prepare contexts for ingestion
		const contexts = prepareBenchmarkContexts(items, benchmarkConfig);

		let completed = 0;
		for (const context of contexts) {
			// Check if already ingested
			const shouldSkip = await this.checkpointManager.shouldSkip(
				runId,
				benchmarkName,
				providerName,
				context.id,
				"ingest",
			);

			if (shouldSkip) {
				completed++;
				continue;
			}

			try {
				// Mark in progress
				await this.checkpointManager.markInProgress(
					runId,
					benchmarkName,
					providerName,
					context.id,
					"ingest",
				);

				// Add to provider
				await provider.addContext(context, runTag);

				// Mark complete
				await this.checkpointManager.markComplete(
					runId,
					benchmarkName,
					providerName,
					context.id,
					"ingest",
				);

				completed++;

				// Report progress
				this.onProgress?.({
					benchmark: benchmarkName,
					provider: providerName,
					current: completed,
					total: contexts.length,
					phase: "ingest",
				});
			} catch (error) {
				await this.checkpointManager.markFailed(
					runId,
					benchmarkName,
					providerName,
					context.id,
					"ingest",
					String(error),
				);
				console.error(`Failed to ingest context ${context.id}:`, error);
			}
		}
	}

	/**
	 * Evaluate phase - search and evaluate each item.
	 */
	private async evaluatePhase(
		provider: Provider,
		items: BenchmarkItem[],
		benchmarkConfig: BenchmarkConfig,
		runId: string,
		runTag: string,
		providerName: string,
	): Promise<EvalResult[]> {
		const benchmarkName = benchmarkConfig.name;
		const results: EvalResult[] = [];

		let completed = 0;
		let correctCount = 0;

		for (const item of items) {
			// Check if already evaluated
			const shouldSkip = await this.checkpointManager.shouldSkip(
				runId,
				benchmarkName,
				providerName,
				item.id,
				"evaluate",
			);

			if (shouldSkip) {
				completed++;
				continue;
			}

			try {
				// Mark in progress
				await this.checkpointManager.markInProgress(
					runId,
					benchmarkName,
					providerName,
					item.id,
					"evaluate",
				);

				// Start total timing
				const totalStart = performance.now();

				// Search for relevant context (with timing)
				const { result: searchResults, latencyMs: searchLatencyMs } =
					await measureLatency(() =>
						provider.searchQuery(item.question, runTag, {
							limit: benchmarkConfig.search?.defaultLimit ?? 10,
							threshold: benchmarkConfig.search?.defaultThreshold ?? 0.3,
							includeChunks: benchmarkConfig.search?.includeChunks ?? false,
						}),
					);

				// Evaluate (with timing)
				const { result: evaluation, latencyMs: evalLatencyMs } =
					await measureLatency(() =>
						this.evaluate(item, searchResults, benchmarkConfig),
					);

				const totalLatencyMs = performance.now() - totalStart;

				// Build telemetry data
				const telemetry: ItemTelemetry = {
					searchLatencyMs,
					totalLatencyMs,
					// answerLatencyMs and judgeLatencyMs will be populated
					// once the real LLM judge is wired up
				};

				// Note: When using llm-judge evaluation method, the evalLatencyMs
				// includes both answer generation and judging. Once the real
				// evaluator is integrated, we'll split this into answerLatencyMs
				// and judgeLatencyMs separately.
				if (benchmarkConfig.evaluation?.method === "llm-judge") {
					// For now, attribute the eval time to the combined answer+judge
					// This will be refined when the real evaluator is integrated
					telemetry.answerLatencyMs = evalLatencyMs;
				}

				const evalResult: EvalResult = {
					runId,
					benchmark: benchmarkName,
					provider: providerName,
					itemId: item.id,
					question: item.question,
					expected: item.answer,
					actual: evaluation.answer,
					score: evaluation.score,
					correct: evaluation.correct,
					retrievedContext: searchResults,
					metadata: addTelemetryToMetadata(
						{
							...item.metadata,
							questionType: item.questionType,
							category: item.category,
						},
						telemetry,
					),
				};

				results.push(evalResult);

				if (evaluation.correct) {
					correctCount++;
				}

				// Mark complete
				await this.checkpointManager.markComplete(
					runId,
					benchmarkName,
					providerName,
					item.id,
					"evaluate",
				);

				completed++;

				// Report progress
				const currentAccuracy =
					completed > 0 ? correctCount / completed : 0;
				this.onProgress?.({
					benchmark: benchmarkName,
					provider: providerName,
					current: completed,
					total: items.length,
					phase: "evaluate",
					currentAccuracy,
				});
			} catch (error) {
				await this.checkpointManager.markFailed(
					runId,
					benchmarkName,
					providerName,
					item.id,
					"evaluate",
					String(error),
				);
				console.error(`Failed to evaluate item ${item.id}:`, error);
			}
		}

		return results;
	}

	/**
	 * Evaluate a single item using the configured evaluation method.
	 * Supports exact-match and LLM-judge evaluation.
	 */
	private async evaluate(
		item: BenchmarkItem,
		searchResults: SearchResult[],
		benchmarkConfig: BenchmarkConfig,
	): Promise<{ answer: string; score: number; correct: boolean; reasoning?: string }> {
		// Use the real evaluator from llm-judge.ts
		const result = await evaluateWithLLM(item, searchResults, benchmarkConfig);

		return {
			answer: result.answer,
			score: result.score,
			correct: result.correct,
			reasoning: result.reasoning,
		};
	}

	/**
	 * Format run tag for provider scoping.
	 */
	private formatRunTag(
		benchmarkConfig: BenchmarkConfig,
		providerConfig: import("./config.ts").ProviderConfig,
		runId: string,
	): string {
		const format =
			providerConfig.scoping?.runIdFormat ?? "${benchmarkId}-${runId}";

		return format
			.replace("${benchmarkId}", benchmarkConfig.name)
			.replace("${runId}", runId);
	}

	/**
	 * Generate a unique run ID.
	 */
	private generateRunId(): string {
		const date = new Date();
		const datePart = date.toISOString().slice(0, 10).replace(/-/g, "");
		const timePart = date.toISOString().slice(11, 19).replace(/:/g, "");
		const randomPart = Math.random().toString(36).substring(2, 6);
		return `run-${datePart}-${timePart}-${randomPart}`;
	}

	/**
	 * Calculate summary statistics.
	 */
	private calculateSummary(results: BenchmarkProviderResult[]): RunSummary {
		const totalItems = results.reduce((sum, r) => sum + r.totalItems, 0);
		const completedItems = results.reduce(
			(sum, r) => sum + r.completedItems,
			0,
		);
		const failedItems = results.reduce((sum, r) => sum + r.failedItems, 0);

		const totalCorrect = results.reduce(
			(sum, r) => sum + r.results.filter((e) => e.correct).length,
			0,
		);

		return {
			totalBenchmarks: new Set(results.map((r) => r.benchmark)).size,
			totalProviders: new Set(results.map((r) => r.provider)).size,
			totalItems,
			completedItems,
			failedItems,
			overallAccuracy: completedItems > 0 ? totalCorrect / completedItems : 0,
		};
	}
}
