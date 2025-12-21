/**
 * YAML Configuration Loader for Dataset Registry
 *
 * Reads datasets.yaml and provides typed access to dataset configurations.
 * Replaces hardcoded URLs and repo lists with declarative configuration.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const YAML_PATH = join(__dirname, "datasets.yaml");

// ============================================================================
// Type Definitions (matching YAML structure)
// ============================================================================

export interface SourceConfig {
	type: "zip" | "tar_xz" | "huggingface_parquet" | "huggingface_json";
	url?: string;
	dataset?: string;
	config?: string;
	split?: string;
	maxRows?: number;
	extractTo?: string;
}

export interface TaskTypeConfig {
	description: string;
	repos: SourceConfig;
	repoList: string[];
}

export interface LanguageSourceConfig {
	source: SourceConfig;
	outputFile: string;
}

export interface PostExtractConfig {
	pattern: string;
	outputPattern: string;
}

export interface DatasetConfig {
	description: string;
	envVar: string;
	sources?: Record<string, SourceConfig>;
	source?: SourceConfig;
	taskTypes?: Record<string, TaskTypeConfig>;
	languages?: Record<string, LanguageSourceConfig> | string[];
	outputFile?: string;
	postExtract?: PostExtractConfig;
}

export interface DatasetsYaml {
	datasets: Record<string, DatasetConfig>;
}

// ============================================================================
// Configuration Loading (with caching)
// ============================================================================

let cachedConfig: DatasetsYaml | null = null;

/**
 * Load and parse datasets.yaml (cached after first load).
 * Caching avoids repeated disk reads during evaluation runs.
 */
export function loadDatasetsConfig(): DatasetsYaml {
	if (cachedConfig) return cachedConfig;

	const content = readFileSync(YAML_PATH, "utf-8");
	cachedConfig = parseYaml(content) as DatasetsYaml;
	return cachedConfig;
}

/**
 * Clear the cached configuration (useful for testing).
 */
export function clearConfigCache(): void {
	cachedConfig = null;
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get configuration for a specific dataset.
 */
export function getDatasetConfig(name: string): DatasetConfig | undefined {
	const config = loadDatasetsConfig();
	return config.datasets[name];
}

/**
 * Get all dataset names from configuration.
 */
export function getConfiguredDatasetNames(): string[] {
	const config = loadDatasetsConfig();
	return Object.keys(config.datasets);
}

/**
 * Get available task types for a dataset (e.g., RepoEval: function, line, api).
 */
export function getAvailableTaskTypes(datasetName: string): string[] {
	const config = getDatasetConfig(datasetName);
	if (!config?.taskTypes) return [];
	return Object.keys(config.taskTypes);
}

/**
 * Get task type configuration.
 */
export function getTaskTypeConfig(
	datasetName: string,
	taskType: string,
): TaskTypeConfig | undefined {
	const config = getDatasetConfig(datasetName);
	if (!config?.taskTypes) return undefined;
	return config.taskTypes[taskType];
}

/**
 * Get repo list for a specific task type.
 * Returns empty array if dataset or task type not found.
 */
export function getRepoListForTaskType(
	datasetName: string,
	taskType: string,
): string[] {
	const taskConfig = getTaskTypeConfig(datasetName, taskType);
	return taskConfig?.repoList ?? [];
}

/**
 * Get source configuration for a named source.
 * Used for datasets with multiple download sources (e.g., RepoEval: datasets + repos).
 */
export function getSourceConfig(
	datasetName: string,
	sourceName: string,
): SourceConfig | undefined {
	const config = getDatasetConfig(datasetName);
	if (!config?.sources) return undefined;
	return config.sources[sourceName];
}

/**
 * Get language-specific configuration for datasets with language variants.
 * Works for both object-style (RepoBench-R) and array-style (CrossCodeEval) languages.
 */
export function getLanguageConfig(
	datasetName: string,
	language: string,
): LanguageSourceConfig | undefined {
	const config = getDatasetConfig(datasetName);
	if (!config?.languages) return undefined;

	// Object-style: { python: { source: {...}, outputFile: "..." } }
	if (!Array.isArray(config.languages)) {
		return config.languages[language];
	}

	// Array-style: ["python", "java", ...] - no per-language config
	return undefined;
}

/**
 * Get list of supported languages for a dataset.
 */
export function getSupportedLanguages(datasetName: string): string[] {
	const config = getDatasetConfig(datasetName);
	if (!config?.languages) return [];

	if (Array.isArray(config.languages)) {
		return config.languages;
	}

	return Object.keys(config.languages);
}
