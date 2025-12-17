/**
 * Benchmark data loaders for different data sources.
 */

import type { BenchmarkConfig, BenchmarkItem, PreparedData } from "../../core/config.ts";

export { loadBenchmarkData, prepareBenchmarkContexts } from "./loader.ts";
export { loadLocalData } from "./local.ts";

/**
 * Data source types supported by the loaders.
 */
export type DataSourceType = "local" | "huggingface" | "url";

/**
 * Raw data item before schema mapping.
 */
export type RawDataItem = Record<string, unknown>;

