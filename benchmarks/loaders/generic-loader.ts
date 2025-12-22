/**
 * Generic Code Retrieval Loader
 *
 * Unified loader for all code retrieval benchmark datasets.
 * Uses the dataset registry for dataset-specific behavior.
 *
 * Replaces 4 separate loader files with a single factory function.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BenchmarkConfig, BenchmarkItem } from "../../core/config.ts";
import { getDataset, getDatasetNames } from "./download/dataset-registry.ts";
import { applyFilters } from "./download/download-utils.ts";

export interface LoadOptions {
	limit?: number;
	start?: number;
	end?: number;
	language?: string;
	/** Task type for RepoEval: "function" (default), "line", or "api" */
	taskType?: "function" | "line" | "api";
}

/**
 * Load benchmark data for a dataset.
 *
 * @param datasetName - Name of the dataset (repoeval, repobench-r, crosscodeeval, swebench-lite)
 * @param config - Benchmark configuration
 * @param options - Loading options (limit, start, end, language)
 * @returns Array of BenchmarkItems
 */
export async function loadCodeRetrievalData(
	datasetName: string,
	config: BenchmarkConfig,
	options?: LoadOptions,
): Promise<BenchmarkItem[]> {
	const dataset = getDataset(datasetName);
	if (!dataset) {
		throw new Error(
			`Unknown dataset: ${datasetName}. Available: ${getDatasetNames().join(", ")}`,
		);
	}

	// Ensure data is available.
	// NOTE: RepoEval has multiple task types ("function", "line", "api") with different repo zips.
	// The eval path must ensure the *requested* task type repos are present; otherwise loadTasks()
	// will filter everything out and you'll see 0/0 items.
	if (datasetName === "repoeval") {
		const tt = options?.taskType ?? "function";
		const datasetsDir = join(dataset.dataDir, "datasets");
		const reposDir =
			tt === "line"
				? join(dataset.dataDir, "repositories/line")
				: tt === "api"
					? join(dataset.dataDir, "repositories/api")
					: join(dataset.dataDir, "repositories");

		if (!existsSync(datasetsDir) || !existsSync(reposDir)) {
			console.log(`${datasetName} (${tt}) data not found, downloading...`);
			await dataset.download({ taskType: tt });
		}
	} else if (!dataset.isAvailable()) {
		console.log(`${datasetName} data not found, downloading...`);
		await dataset.download();
	}

	// Infer language from config if not provided
	const language = options?.language ?? inferLanguageFromConfig(config);

	// Load raw tasks (pass taskType for RepoEval)
	let tasks = await dataset.loadTasks({ 
		language, 
		taskType: options?.taskType,
	});

	// For datasets that do expensive repo cloning (repoeval, swebench-lite),
	// apply filters before conversion to avoid unnecessary cloning
	const needsEarlyFilter = datasetName === "repoeval" || datasetName === "swebench-lite";
	if (needsEarlyFilter) {
		tasks = applyFilters(tasks, options);
	}

	// Convert tasks to BenchmarkItems
	const items: BenchmarkItem[] = [];
	for (const task of tasks) {
		try {
			const item = await dataset.toBenchmarkItem(task, {
				taskType: options?.taskType,
				hardNegatives: config.hardNegatives,
				// Pass excludeTargetFile from hardNegatives config
				// This enables cross-file retrieval mode (finding RELATED code, not SAME code)
				excludeTargetFile: config.hardNegatives?.excludeTargetFile,
				// Pass IoU threshold for stricter relevance checking
				// Higher threshold = chunks must align more precisely with ground truth
				iouThreshold: config.hardNegatives?.iouThreshold,
			});
			// Skip items with no contexts
			if (item.contexts.length > 0) {
				items.push(item);
			}
		} catch (error) {
			console.warn(`Failed to load task ${task.id}: ${error}`);
		}
	}

	// Apply filters after conversion for non-cloning datasets
	if (!needsEarlyFilter) {
		return applyFilters(items, options);
	}

	return items;
}

/**
 * Infer programming language from config path.
 */
function inferLanguageFromConfig(config: BenchmarkConfig): string | undefined {
	const path = config.data.localPath?.toLowerCase();
	if (!path) return undefined;

	if (path.includes("java")) return "java";
	if (path.includes("python")) return "python";
	if (path.includes("typescript")) return "typescript";
	if (path.includes("csharp")) return "csharp";
	if (path.includes("1k")) return "1k";
	if (path.includes("2k")) return "2k";
	if (path.includes("4k")) return "4k";

	return undefined;
}

// ============================================================================
// Backward Compatibility Exports
// ============================================================================

/**
 * Load RepoEval benchmark data.
 */
export async function loadRepoEvalData(
	config: BenchmarkConfig,
	options?: LoadOptions,
): Promise<BenchmarkItem[]> {
	return loadCodeRetrievalData("repoeval", config, options);
}

/**
 * Load RepoBench-R benchmark data.
 */
export async function loadRepoBenchRData(
	config: BenchmarkConfig,
	options?: LoadOptions,
): Promise<BenchmarkItem[]> {
	return loadCodeRetrievalData("repobench-r", config, options);
}

/**
 * Load CrossCodeEval benchmark data.
 */
export async function loadCrossCodeEvalData(
	config: BenchmarkConfig,
	options?: LoadOptions,
): Promise<BenchmarkItem[]> {
	return loadCodeRetrievalData("crosscodeeval", config, options);
}

/**
 * Load SWE-bench Lite benchmark data.
 */
export async function loadSWEBenchLiteData(
	config: BenchmarkConfig,
	options?: LoadOptions,
): Promise<BenchmarkItem[]> {
	return loadCodeRetrievalData("swebench-lite", config, options);
}

// Re-export dataset utilities
export { getDataset, getDatasetNames } from "./download/dataset-registry.ts";
export { parsePatch, type PatchFile } from "./download/dataset-registry.ts";
