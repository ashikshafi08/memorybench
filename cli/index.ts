#!/usr/bin/env bun
/**
 * Superbench CLI entry point.
 * Provides commands for listing, describing, and running benchmarks.
 */

import { Registry, getRegistry } from "../core/registry.ts";
import { CheckpointManager } from "../core/checkpoint.ts";
import { BenchmarkRunner, type ProgressCallback, type RunResult } from "../core/runner.ts";
import { ResultsStore } from "../core/results.ts";
import { getDefaultRegistry, getAvailableMetrics } from "../core/metrics/index.ts";
import type { MetricResult } from "../core/metrics/interface.ts";
import { tableCommand } from "./table.ts";
import { policyCompareCommand, parsePolicyCompareOptions } from "./policy-compare.ts";

interface ParsedArgs {
	command: string;
	args: string[];
	options: Record<string, string | string[] | boolean>;
}

/**
 * Safely convert an option value to a string array.
 * Filters out boolean values and wraps single strings in an array.
 * Splits comma-separated values (e.g., "a,b,c" → ["a", "b", "c"]).
 */
function toStringArray(
	value: string | string[] | boolean | undefined,
): string[] | undefined {
	if (value === undefined || value === true) return undefined;
	if (value === false) return undefined;
	if (Array.isArray(value)) {
		// Flatten any comma-separated values within the array
		return value.flatMap((v) => v.split(",").map((s) => s.trim())).filter(Boolean);
	}
	// Split single string on commas
	return value.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Format a metric value for display.
 */
function formatMetricValue(name: string, value: number): string {
	// Most metrics are ratios (0-1), display as percentage
	const isPercentage = /accuracy|recall|precision|mrr|success|rate|f1|bleu|rouge/i.test(name);
	if (isPercentage) {
		return `${(value * 100).toFixed(1)}%`;
	}
	// Latency metrics are in ms
	if (/latency/i.test(name)) {
		return `${value.toFixed(0)}ms`;
	}
	return value.toFixed(4);
}

/**
 * Print results in a clean table format.
 */
function printResultsTable(result: RunResult): void {
	// Collect all unique metric names across all results
	const allMetricNames = new Set<string>();
	for (const r of result.results) {
		for (const m of r.metrics) {
			allMetricNames.add(m.name);
		}
	}
	const metricNames = Array.from(allMetricNames);

	// Calculate column widths
	const benchProviderCol = Math.max(
		20,
		...result.results.map((r) => `${r.benchmark} × ${r.provider}`.length),
	);
	const itemsCol = 10;
	const metricColWidth = 12;

	// Build header
	const headerParts = [
		"Benchmark × Provider".padEnd(benchProviderCol),
		"Items".padStart(itemsCol),
		...metricNames.map((m) => m.padStart(metricColWidth)),
	];
	const headerLine = headerParts.join(" │ ");
	const totalWidth = headerLine.length + 4;

	// Print table
	console.log("\n╭" + "─".repeat(totalWidth) + "╮");
	console.log("│ " + "RESULTS".padEnd(totalWidth - 1) + "│");
	console.log("├" + "─".repeat(totalWidth) + "┤");
	console.log("│ " + headerLine + " │");
	console.log("├" + "─".repeat(totalWidth) + "┤");

	// Print each result row
	for (const r of result.results) {
		const benchProvider = `${r.benchmark} × ${r.provider}`.padEnd(benchProviderCol);
		const items = `${r.completedItems}/${r.totalItems}`.padStart(itemsCol);

		// Build metric values in the same order as header
		const metricValues = metricNames.map((name) => {
			const metric = r.metrics.find((m) => m.name === name);
			if (!metric) return "-".padStart(metricColWidth);
			return formatMetricValue(name, metric.value).padStart(metricColWidth);
		});

		const rowParts = [benchProvider, items, ...metricValues];
		console.log("│ " + rowParts.join(" │ ") + " │");
	}

	console.log("├" + "─".repeat(totalWidth) + "┤");

	// Summary row
	const summaryLabel = "Overall".padEnd(benchProviderCol);
	const summaryItems = `${result.summary.completedItems}/${result.summary.totalItems}`.padStart(itemsCol);
	const summaryAccuracy = formatMetricValue("accuracy", result.summary.overallAccuracy).padStart(metricColWidth);
	
	// Fill other metrics with dashes
	const summaryMetrics = metricNames.map((name) => {
		if (name === "accuracy") return summaryAccuracy;
		return "-".padStart(metricColWidth);
	});

	console.log("│ " + [summaryLabel, summaryItems, ...summaryMetrics].join(" │ ") + " │");
	console.log("╰" + "─".repeat(totalWidth) + "╯");
}

/**
 * Parse command line arguments.
 */
function parseArgs(argv: string[]): ParsedArgs {
	const args = argv.slice(2);
	const command = args[0] ?? "help";
	const restArgs: string[] = [];
	const options: Record<string, string | string[] | boolean> = {};

	for (let i = 1; i < args.length; i++) {
		const arg = args[i];

		if (!arg) continue;

		if (arg.startsWith("--")) {
			const key = arg.slice(2);
			const nextArg = args[i + 1];

			// Check if it's a boolean flag or has a value
			if (!nextArg || nextArg.startsWith("-")) {
				options[key] = true;
			} else {
				// Collect multiple values for array options
				const values: string[] = [];
				while (
					i + 1 < args.length &&
					args[i + 1] &&
					!args[i + 1]!.startsWith("-")
				) {
					i++;
					values.push(args[i]!);
				}
				options[key] = values.length === 1 ? values[0]! : values;
			}
		} else if (arg.startsWith("-")) {
			const key = arg.slice(1);
			const nextArg = args[i + 1];

			if (!nextArg || nextArg.startsWith("-")) {
				options[key] = true;
			} else {
				const values: string[] = [];
				while (
					i + 1 < args.length &&
					args[i + 1] &&
					!args[i + 1]!.startsWith("-")
				) {
					i++;
					values.push(args[i]!);
				}
				options[key] = values.length === 1 ? values[0]! : values;
			}
		} else {
			restArgs.push(arg);
		}
	}

	return { command, args: restArgs, options };
}

/**
 * Print help message.
 */
function printHelp(): void {
	console.log(`
╭─────────────────────────────────────────────────────────────────╮
│                         SUPERBENCH                              │
│         Config-driven benchmarking for memory providers          │
╰─────────────────────────────────────────────────────────────────╯

Usage:
  superbench <command> [options]

Commands:
  list              List available providers and benchmarks
  describe <name>   Describe a specific benchmark or provider
  download          Download benchmark datasets
  eval              Run evaluation
  eval:policy       Run policy comparison (1-hop vs H-hop)
  results <runId>   View results for a run
  table             Generate comparison table from results
  export <runId>    Export results to file
  help              Show this help message

Examples:
  superbench list --providers
  superbench list --benchmarks --tags temporal
  superbench describe longmemeval
  superbench eval --benchmarks longmemeval --providers supermemory --limit 10
  superbench eval --benchmarks rag-template --providers supermemory --metrics accuracy f1 recall_at_5
  superbench eval --benchmarks repoeval --providers code-chunk-ast --task-type function  (default)
  superbench eval --benchmarks repoeval --providers code-chunk-ast --task-type line
  superbench eval --benchmarks repoeval --providers code-chunk-ast --task-type api
  superbench eval --benchmarks repoeval --providers code-chunk-ast --policy all  (runs both 1-hop and H-hop)
  superbench table --run <runId> --benchmark repoeval
  superbench results run-20251216-123456-abc1
  superbench export run-20251216-123456-abc1 --format csv --output results.csv

Metrics (use with --metrics):

  Memory Metrics (recommended for memory benchmarks):
    accuracy              LLM-judge correctness
    accuracy_by_question_type  Breakdown by question type
    accuracy_by_category  Breakdown by category
    f1                    Token-level F1 score
    bleu_1                BLEU-1 unigram precision
    rouge_l               ROUGE-L longest common subsequence
    success_at_5, success_at_10   Semantic retrieval success
    recall_at_5, recall_at_10     Context recall

  Retrieval Metrics (for pure retrieval benchmarks):
    mrr                   Mean Reciprocal Rank (not for memory!)
    precision_at_5, precision_at_10  Precision at K
    avg_retrieval_score   Average similarity score

  Performance Metrics:
    avg_search_latency_ms Average search latency
    avg_total_latency_ms  Average end-to-end latency
    p95_latency_ms        95th percentile latency

Run 'superbench <command> --help' for more information on a command.
`);
}

/**
 * List command - list providers and benchmarks.
 */
async function listCommand(
	registry: Registry,
	options: Record<string, string | string[] | boolean>,
): Promise<void> {
	const showProviders = options.providers === true || !options.benchmarks;
	const showBenchmarks = options.benchmarks === true || !options.providers;
	const tags = toStringArray(options.tags);

	if (showProviders) {
		const providers = registry.listProviders({ tags });
		console.log("\n📦 Providers:");
		console.log("─".repeat(60));

		if (providers.length === 0) {
			console.log("  No providers found.");
		} else {
			for (const p of providers) {
				const tagsStr = p.tags?.length ? ` [${p.tags.join(", ")}]` : "";
				console.log(`  ${p.name.padEnd(25)} ${p.displayName}${tagsStr}`);
				if (p.description) {
					console.log(`                           ${p.description}`);
				}
			}
		}
	}

	if (showBenchmarks) {
		const benchmarks = registry.listBenchmarks({ tags });
		console.log("\n📊 Benchmarks:");
		console.log("─".repeat(60));

		if (benchmarks.length === 0) {
			console.log("  No benchmarks found.");
		} else {
			for (const b of benchmarks) {
				const tagsStr = b.tags?.length ? ` [${b.tags.join(", ")}]` : "";
				console.log(`  ${b.name.padEnd(25)} ${b.displayName}${tagsStr}`);
				if (b.description) {
					console.log(`                           ${b.description}`);
				}
			}
		}
	}

	console.log();
}

/**
 * Describe command - show details about a provider or benchmark.
 */
async function describeCommand(
	registry: Registry,
	name: string,
): Promise<void> {
	// Try as provider first
	if (registry.hasProvider(name)) {
		const p = registry.getProvider(name);
		console.log(`\n📦 Provider: ${p.displayName}`);
		console.log("─".repeat(60));
		console.log(`  Name:        ${p.name}`);
		console.log(`  Type:        ${p.type}`);
		if (p.description) console.log(`  Description: ${p.description}`);
		if (p.tags?.length) console.log(`  Tags:        ${p.tags.join(", ")}`);

		if (p.capabilities) {
			console.log("\n  Capabilities:");
			console.log(`    Chunks:    ${p.capabilities.supportsChunks}`);
			console.log(`    Batch:     ${p.capabilities.supportsBatch}`);
			console.log(`    Metadata:  ${p.capabilities.supportsMetadata}`);
			console.log(`    Rerank:    ${p.capabilities.supportsRerank}`);

		}

		console.log();
		return;
	}

	// Try as benchmark
	if (registry.hasBenchmark(name)) {
		const b = registry.getBenchmark(name);
		console.log(`\n📊 Benchmark: ${b.displayName}`);
		console.log("─".repeat(60));
		console.log(`  Name:        ${b.name}`);
		if (b.version) console.log(`  Version:     ${b.version}`);
		if (b.description) console.log(`  Description: ${b.description}`);
		if (b.paper) console.log(`  Paper:       ${b.paper}`);
		if (b.source) console.log(`  Source:      ${b.source}`);
		if (b.tags?.length) console.log(`  Tags:        ${b.tags.join(", ")}`);

		console.log("\n  Data:");
		console.log(`    Type:      ${b.data.type}`);
		console.log(`    Path:      ${b.data.path}`);
		console.log(`    Format:    ${b.data.format}`);

		if (b.questionTypes?.length) {
			console.log("\n  Question Types:");
			for (const qt of b.questionTypes) {
				console.log(`    - ${qt.name}`);
			}
		}

		

		if (b.metrics?.length) {
			console.log("\n  Metrics:");
			console.log(`    ${b.metrics.join(", ")}`);
		}

		console.log();
		return;
	}

	console.error(`\n❌ Not found: '${name}' is not a known provider or benchmark.\n`);
	process.exit(1);
}

/**
 * Download command - download benchmark datasets.
 */
async function downloadCommand(
	options: Record<string, string | string[] | boolean>,
): Promise<void> {
	const { getDataset, getDatasetNames } = await import(
		"../benchmarks/loaders/download/dataset-registry.ts"
	);
	const { getAvailableTaskTypes } = await import(
		"../benchmarks/loaders/download/yaml-config.ts"
	);

	const benchmarkNames = toStringArray(options.benchmarks) ?? toStringArray(options.benchmark);
	const allFlag = options.all === true;
	const taskType = options["task-type"] as "function" | "line" | "api" | "all" | undefined;

	// Determine which datasets to download
	let datasetsToDownload: string[];

	if (allFlag) {
		datasetsToDownload = getDatasetNames();
	} else if (benchmarkNames && benchmarkNames.length > 0) {
		datasetsToDownload = benchmarkNames;
	} else {
		console.log(`
╭─────────────────────────────────────────────────────────────────╮
│                      DOWNLOAD DATASETS                          │
╰─────────────────────────────────────────────────────────────────╯

Usage:
  superbench download --benchmark <name>    Download a specific dataset
  superbench download --benchmarks <names>  Download multiple datasets
  superbench download --all                 Download all datasets

Options:
  --task-type <type>   Task type for RepoEval: function (default), line, api, all

Available datasets:
${getDatasetNames().map((n: string) => `  - ${n}`).join("\n")}

Examples:
  superbench download --benchmark repoeval
  superbench download --benchmark repoeval --task-type line
  superbench download --benchmark repoeval --task-type all
  superbench download --benchmarks repoeval repobench-r
  superbench download --all
`);
		return;
	}

	console.log(`\n📥 Downloading ${datasetsToDownload.length} dataset(s)...\n`);

	for (const name of datasetsToDownload) {
		const dataset = getDataset(name);
		if (!dataset) {
			console.error(`❌ Unknown dataset: ${name}`);
			console.log(`   Available: ${getDatasetNames().join(", ")}`);
			continue;
		}

		// Check for task types (RepoEval specific)
		const availableTaskTypes = getAvailableTaskTypes(name);
		
		if (availableTaskTypes.length > 0 && taskType === "all") {
			// Download all task types
			for (const tt of availableTaskTypes) {
				console.log(`📥 ${name} (${tt}): Downloading...`);
				try {
					await dataset.download({ taskType: tt as "function" | "line" | "api" });
					console.log(`✅ ${name} (${tt}): Download complete`);
				} catch (error) {
					console.error(`❌ ${name} (${tt}): Download failed - ${error}`);
				}
			}
		} else if (dataset.isAvailable() && !taskType) {
			console.log(`✅ ${name}: Already downloaded`);
		} else {
			console.log(`📥 ${name}${taskType ? ` (${taskType})` : ""}: Downloading...`);
			try {
				await dataset.download(taskType ? { taskType: taskType as "function" | "line" | "api" } : undefined);
				console.log(`✅ ${name}${taskType ? ` (${taskType})` : ""}: Download complete`);
			} catch (error) {
				console.error(`❌ ${name}: Download failed - ${error}`);
			}
		}
	}

	console.log("\n✨ Done!\n");
}

/**
 * Eval command - run benchmarks against providers.
 */
async function evalCommand(
	registry: Registry,
	options: Record<string, string | string[] | boolean>,
): Promise<void> {
	// Parse options
	const benchmarks = toStringArray(options.benchmarks) ?? [];
	const providers = toStringArray(options.providers) ?? [];

	if (benchmarks.length === 0) {
		console.error(
			"❌ No benchmarks specified. Use --benchmarks to specify at least one benchmark.",
		);
		process.exit(1);
	}

	if (providers.length === 0) {
		console.error(
			"❌ No providers specified. Use --providers to specify at least one provider.",
		);
		process.exit(1);
	}

	// Validate benchmarks and providers exist
	for (const b of benchmarks) {
		if (!registry.hasBenchmark(b)) {
			console.error(`❌ Unknown benchmark: ${b}`);
			process.exit(1);
		}
	}

	for (const p of providers) {
		if (!registry.hasProvider(p)) {
			console.error(`❌ Unknown provider: ${p}`);
			process.exit(1);
		}
	}

	// Parse other options
	const limit = options.limit ? parseInt(options.limit as string, 10) : undefined;
	const start = options.start ? parseInt(options.start as string, 10) : undefined;
	const end = options.end ? parseInt(options.end as string, 10) : undefined;
	const concurrency = options.concurrency
		? parseInt(options.concurrency as string, 10)
		: 10;
	const questionType = options["question-type"] as string | undefined;
	const taskType = options["task-type"] as "function" | "line" | "api" | undefined;
	const runId = options["run-id"] as string | undefined;
	const outputDir = (options.output as string) ?? "./results";
	const metrics = toStringArray(options.metrics);
	
	// Parse policy option (1-hop, H-hop, or all)
	const policyStr = (options.policy as string)?.toLowerCase();
	const policies: ("1-hop" | "H-hop")[] =
		policyStr === "all" ? ["1-hop", "H-hop"] :
		policyStr === "h-hop" ? ["H-hop"] :
		["1-hop"];

	// Validate metrics if provided
	if (metrics && metrics.length > 0) {
		const metricRegistry = getDefaultRegistry();
		for (const metric of metrics) {
			if (!metricRegistry.has(metric)) {
				const available = getAvailableMetrics();
				console.error(
					`❌ Unknown metric "${metric}". Available: ${available.join(", ")}`,
				);
				process.exit(1);
			}
		}
	}

	// Create components
	const checkpointManager = new CheckpointManager("./checkpoints");
	const resultsStore = new ResultsStore(`${outputDir}/results.db`);

	// Progress callback
	const onProgress: ProgressCallback = (progress) => {
		const pct = ((progress.current / progress.total) * 100).toFixed(1);
		const accuracyStr =
			progress.currentAccuracy !== undefined
				? ` | Accuracy: ${(progress.currentAccuracy * 100).toFixed(1)}%`
				: "";
		process.stdout.write(
			`\r  [${progress.phase.toUpperCase().padEnd(8)}] ${progress.benchmark} × ${progress.provider}: ${progress.current}/${progress.total} (${pct}%)${accuracyStr}`,
		);
	};

	// Create runner
	const runner = new BenchmarkRunner(registry, checkpointManager, {
		onProgress,
	});

	// Print header
	console.log(`
╭─────────────────────────────────────────────────────────────────╮
│                    SUPERBENCH EVALUATION                        │
├─────────────────────────────────────────────────────────────────┤
│ Benchmarks: ${benchmarks.join(", ").padEnd(49)} │
│ Providers:  ${providers.join(", ").padEnd(49)} │
│ Policies:   ${policies.join(", ").padEnd(49)} │
│ Started:    ${new Date().toISOString().padEnd(49)} │
╰─────────────────────────────────────────────────────────────────╯
`);

	try {
		// Run evaluation for each policy
		for (const policy of policies) {
			if (policies.length > 1) {
				console.log(`\n📋 Running with policy: ${policy}\n`);
			}

			const result = await runner.run({
				benchmarks,
				providers,
				limit,
				start,
				end,
				questionType,
				taskType,
				concurrency,
				runId: runId ? `${runId}-${policy}` : undefined,
				outputDir,
				metrics,
				policy,
			});

			// Clear progress line
			console.log("\n");

			// Save results
			resultsStore.saveRun(result);

			// Print results in table format
			printResultsTable(result);

			console.log(`\n✅ Run ID: ${result.runId}`);
			console.log(`   Results saved to: ${outputDir}/results.db`);
			console.log(`   View results: superbench results ${result.runId}\n`);
		}
	} catch (error) {
		console.error("\n❌ Evaluation failed:", error);
		process.exit(1);
	} finally {
		resultsStore.close();
	}
}

/**
 * Results command - view results for a run.
 */
async function resultsCommand(
	runId: string,
	options: Record<string, string | string[] | boolean>,
): Promise<void> {
	const outputDir = (options.output as string) ?? "./results";
	const resultsStore = new ResultsStore(`${outputDir}/results.db`);

	try {
		const run = resultsStore.getRun(runId);

		if (!run) {
			console.error(`\n❌ Run not found: ${runId}\n`);
			process.exit(1);
		}

		// Parse metrics to compute (if provided)
		const requestedMetrics = toStringArray(options.metrics) ?? ["accuracy"];

		// Validate metrics
		const metricRegistry = getDefaultRegistry();
		for (const metric of requestedMetrics) {
			if (!metricRegistry.has(metric)) {
				const available = getAvailableMetrics();
				console.error(
					`❌ Unknown metric "${metric}". Available: ${available.join(", ")}`,
				);
				process.exit(1);
			}
		}

		// Get all results for this run
		const allResults = resultsStore.getRunResults(runId);

		// Group results by benchmark/provider
		const groupedResults = new Map<string, typeof allResults>();
		for (const result of allResults) {
			const key = `${result.benchmark}|${result.provider}`;
			if (!groupedResults.has(key)) {
				groupedResults.set(key, []);
			}
			groupedResults.get(key)!.push(result);
		}

		console.log(`
╭─────────────────────────────────────────────────────────────────────────────╮
│ RUN: ${runId.padEnd(69)} │
├─────────────────────────────────────────────────────────────────────────────┤
│ Started:    ${run.startedAt.padEnd(62)} │
│ Completed:  ${(run.completedAt ?? "N/A").padEnd(62)} │
│ Benchmarks: ${run.benchmarks.padEnd(62)} │
│ Providers:  ${run.providers.padEnd(62)} │
╰─────────────────────────────────────────────────────────────────────────────╯
`);

		if (groupedResults.size > 0) {
			console.log("Results (computed via registry):");
			console.log("─".repeat(75));

			for (const [key, results] of groupedResults) {
				const [benchmark, provider] = key.split("|");
				console.log(`\n  ${benchmark} × ${provider} (${results.length} items):`);

				// Compute metrics using the registry
				const computedMetrics = metricRegistry.computeAll(
					requestedMetrics,
					results,
				);

				for (const metric of computedMetrics) {
					const displayValue =
						metric.name.includes("accuracy") ||
						metric.name.includes("recall") ||
						metric.name.includes("precision") ||
						metric.name === "mrr"
							? `${(metric.value * 100).toFixed(1)}%`
							: metric.value.toFixed(4);
					console.log(`    ${metric.name}: ${displayValue}`);

					// Show details if present and breakdown is requested
					if (
						options.breakdown &&
						metric.details &&
						Object.keys(metric.details).length > 0
					) {
						for (const [detailKey, detailVal] of Object.entries(
							metric.details,
						)) {
							let detailValue: string;
							if (typeof detailVal === "number") {
								// Only format as percentage if it's a ratio (0-1) and key suggests it's a rate
								const isRatio = detailVal >= 0 && detailVal <= 1;
								const isRatioKey = /accuracy|precision|recall|f1|rate|ratio|score/i.test(detailKey);
								if (isRatio && isRatioKey) {
									detailValue = `${(detailVal * 100).toFixed(1)}%`;
								} else {
									detailValue = detailVal % 1 === 0 ? detailVal.toString() : detailVal.toFixed(4);
								}
							} else {
								detailValue = String(detailVal);
							}
							console.log(`      └─ ${detailKey}: ${detailValue}`);
						}
					}
				}
			}
		}

		// Compare providers if requested
		if (options.compare && options.compare !== true) {
			const compareProviders = toStringArray(options.compare) ?? [];

			console.log("\nProvider Comparison:");
			console.log("─".repeat(60));

			const benchmarks = JSON.parse(run.benchmarks) as string[];
			for (const benchmark of benchmarks) {
				const comparison = resultsStore.compareProviders(
					benchmark,
					compareProviders,
				);

				console.log(`  ${benchmark}:`);
				for (const p of comparison.providers) {
					console.log(
						`    ${p.provider}: ${(p.accuracy * 100).toFixed(1)}% (${p.correctItems}/${p.totalItems})`,
					);
				}
			}
		}

		console.log();
	} finally {
		resultsStore.close();
	}
}

/**
 * Export command - export results to file.
 */
async function exportCommand(
	runId: string,
	options: Record<string, string | string[] | boolean>,
): Promise<void> {
	const dbDir = (options.db as string) ?? "./results";
	const resultsStore = new ResultsStore(`${dbDir}/results.db`);
	const format = (options.format as string) ?? "json";
	const outputPath = options.output as string;

	try {
		const run = resultsStore.getRun(runId);

		if (!run) {
			console.error(`\n❌ Run not found: ${runId}\n`);
			process.exit(1);
		}

		let content: string;
		let defaultFilename: string;

		switch (format) {
			case "csv":
				content = resultsStore.exportToCsv(runId);
				defaultFilename = `${runId}.csv`;
				break;
			case "json":
			default:
				content = resultsStore.exportToJson(runId);
				defaultFilename = `${runId}.json`;
				break;
		}

		const finalPath = outputPath ?? defaultFilename;
		await Bun.write(finalPath, content);

		console.log(`\n✅ Results exported to: ${finalPath}\n`);
	} finally {
		resultsStore.close();
	}
}

/**
 * Main CLI entry point.
 */
async function main(): Promise<void> {
	const parsed = parseArgs(Bun.argv);

	// Initialize registry
	const registry = await getRegistry(".");

	switch (parsed.command) {
		case "help":
		case "--help":
		case "-h":
			printHelp();
			break;

		case "list":
			await listCommand(registry, parsed.options);
			break;

		case "describe":
			if (!parsed.args[0]) {
				console.error("\n❌ Please specify a provider or benchmark name.\n");
				process.exit(1);
			}
			await describeCommand(registry, parsed.args[0]);
			break;

		case "download":
			await downloadCommand(parsed.options);
			break;

		case "eval":
			await evalCommand(registry, parsed.options);
			break;

		case "results":
			if (!parsed.args[0]) {
				console.error("\n❌ Please specify a run ID.\n");
				process.exit(1);
			}
			await resultsCommand(parsed.args[0], parsed.options);
			break;

		case "export":
			if (!parsed.args[0]) {
				console.error("\n❌ Please specify a run ID.\n");
				process.exit(1);
			}
			await exportCommand(parsed.args[0], parsed.options);
			break;

		case "table":
			if (!parsed.args[0] && !parsed.options["run"]) {
				console.error("\n❌ Please specify a run ID with --run <runId>\n");
				process.exit(1);
			}
			await tableCommand({
				runId: (parsed.options["run"] as string) ?? parsed.args[0]!,
				benchmark: parsed.options["benchmark"] as string,
				baseline: parsed.options["baseline"] as string,
				dbPath: parsed.options["db"] as string,
			});
			break;

		case "eval:policy":
			await policyCompareCommand(parsePolicyCompareOptions(parsed.options));
			break;

		default:
			console.error(`\n❌ Unknown command: ${parsed.command}\n`);
			printHelp();
			process.exit(1);
	}
}

// Run the CLI
main().catch((error) => {
	console.error("❌ Error:", error);
	process.exit(1);
});

