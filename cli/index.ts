#!/usr/bin/env bun
/**
 * Memorybench CLI entry point.
 * Provides commands for listing, describing, and running benchmarks.
 */

import { Registry, getRegistry } from "../core/registry.ts";
import { CheckpointManager } from "../core/checkpoint.ts";
import { BenchmarkRunner, type ProgressCallback } from "../core/runner.ts";
import { ResultsStore } from "../core/results.ts";

interface ParsedArgs {
	command: string;
	args: string[];
	options: Record<string, string | string[] | boolean>;
}

/**
 * Safely convert an option value to a string array.
 * Filters out boolean values and wraps single strings in an array.
 */
function toStringArray(
	value: string | string[] | boolean | undefined,
): string[] | undefined {
	if (value === undefined || value === true) return undefined;
	if (value === false) return undefined;
	return Array.isArray(value) ? value : [value];
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
│                         MEMORYBENCH                              │
│         Config-driven benchmarking for memory providers          │
╰─────────────────────────────────────────────────────────────────╯

Usage:
  memorybench <command> [options]

Commands:
  list              List available providers and benchmarks
  describe <name>   Describe a specific benchmark or provider
  eval              Run evaluation
  results <runId>   View results for a run
  export <runId>    Export results to file
  help              Show this help message

Examples:
  memorybench list --providers
  memorybench list --benchmarks --tags temporal
  memorybench describe longmemeval
  memorybench eval --benchmarks longmemeval --providers supermemory --limit 10
  memorybench results run-20251216-123456-abc1
  memorybench export run-20251216-123456-abc1 --format csv --output results.csv

Run 'memorybench <command> --help' for more information on a command.
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
	const runId = options["run-id"] as string | undefined;
	const outputDir = (options.output as string) ?? "./results";

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
│                    MEMORYBENCH EVALUATION                        │
├─────────────────────────────────────────────────────────────────┤
│ Benchmarks: ${benchmarks.join(", ").padEnd(49)} │
│ Providers:  ${providers.join(", ").padEnd(49)} │
│ Started:    ${new Date().toISOString().padEnd(49)} │
╰─────────────────────────────────────────────────────────────────╯
`);

	try {
		// Run evaluation
		const result = await runner.run({
			benchmarks,
			providers,
			limit,
			start,
			end,
			questionType,
			concurrency,
			runId,
			outputDir,
		});

		// Clear progress line
		console.log("\n");

		// Save results
		resultsStore.saveRun(result);

		// Print results
		console.log(
			"╭──────────────────────────────────────────────────────────────────╮",
		);
		console.log(`│ RESULTS                                                          │`);
		console.log(
			"├───────────────┬──────────┬───────────────────────────────────────┤",
		);
		console.log(
			`│ Provider      │ Accuracy │ Details                               │`,
		);
		console.log(
			"├───────────────┼──────────┼───────────────────────────────────────┤",
		);

		for (const r of result.results) {
			const accuracy = (r.accuracy * 100).toFixed(1) + "%";
			console.log(
				`│ ${r.provider.padEnd(13)} │ ${accuracy.padEnd(8)} │ ${r.completedItems}/${r.totalItems} items                            │`,
			);
		}

		console.log(
			"╰───────────────┴──────────┴───────────────────────────────────────╯",
		);

		console.log(`\n✅ Run ID: ${result.runId}`);
		console.log(`   Results saved to: ${outputDir}/results.db`);
		console.log(`   View results: memorybench results ${result.runId}\n`);
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

		const metrics = resultsStore.getRunMetrics(runId);

		console.log(`
╭─────────────────────────────────────────────────────────────────╮
│ RUN: ${runId.padEnd(56)} │
├─────────────────────────────────────────────────────────────────┤
│ Started:    ${run.startedAt.padEnd(49)} │
│ Completed:  ${(run.completedAt ?? "N/A").padEnd(49)} │
│ Benchmarks: ${run.benchmarks.padEnd(49)} │
│ Providers:  ${run.providers.padEnd(49)} │
╰─────────────────────────────────────────────────────────────────╯
`);

		if (metrics.length > 0) {
			console.log("Results:");
			console.log("─".repeat(60));

			for (const m of metrics) {
				console.log(
					`  ${m.benchmark} × ${m.provider}: ${(m.accuracy * 100).toFixed(1)}% (${m.correctItems}/${m.totalItems})`,
				);

				// Show breakdown by question type/category if requested
				if (options.breakdown) {
					const byType = resultsStore.getMetricsByQuestionType(
						runId,
						m.benchmark,
						m.provider,
					);
					const byCategory = resultsStore.getMetricsByCategory(
						runId,
						m.benchmark,
						m.provider,
					);

					if (Object.keys(byType).length > 0) {
						console.log("    By Question Type:");
						for (const [type, data] of Object.entries(byType)) {
							console.log(
								`      ${type}: ${(data.accuracy * 100).toFixed(1)}% (${data.correct}/${data.total})`,
							);
						}
					}

					if (Object.keys(byCategory).length > 0) {
						console.log("    By Category:");
						for (const [cat, data] of Object.entries(byCategory)) {
							console.log(
								`      ${cat}: ${(data.accuracy * 100).toFixed(1)}% (${data.correct}/${data.total})`,
							);
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

