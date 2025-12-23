/**
 * Registry for auto-discovering providers and benchmarks from config directories.
 */

import { glob } from "glob";
import { parse } from "yaml";
import { ZodError } from "zod";
import {
	ProviderConfigSchema,
	BenchmarkConfigSchema,
	type ProviderConfig,
	type BenchmarkConfig,
} from "./config.ts";
import { getPackAndValidate } from "./sealed-semantics.ts";

/**
 * Interpolate environment variables in a string.
 * Supports ${VAR} and ${VAR:-default} syntax.
 */
export function interpolateEnvVars(value: string): string {
	return value.replace(
		/\$\{(\w+)(?::-([^}]*))?\}/g,
		(match: string, name: string, defaultValue?: string) => {
			// If the env var is set (and non-empty), substitute it
			const envVal = process.env[name];
			if (envVal !== undefined && envVal !== "") {
				return envVal;
			}

			// If a default is provided (${VAR:-default}), use it
			if (defaultValue !== undefined) {
				return defaultValue;
			}

			// Otherwise preserve the placeholder (important for benchmark prompt templates
			// like ${question}, ${retrievedContext}, and runtime placeholders like
			// ${benchmarkId}-${runId}).
			return match;
		},
	);
}

/**
 * Recursively interpolate environment variables in an object.
 */
function interpolateEnvVarsInObject(obj: unknown): unknown {
	if (typeof obj === "string") {
		return interpolateEnvVars(obj);
	}
	if (Array.isArray(obj)) {
		return obj.map((item) => interpolateEnvVarsInObject(item));
	}
	if (obj !== null && typeof obj === "object") {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(obj)) {
			result[key] = interpolateEnvVarsInObject(value);
		}
		return result;
	}
	return obj;
}

/**
 * Format Zod validation errors for user-friendly display.
 */
function formatZodError(error: ZodError, filePath: string): string {
	const issues = error.issues.map((issue) => {
		const path = issue.path.join(".");
		return `  - ${path ? `${path}: ` : ""}${issue.message}`;
	});
	return `Validation failed for ${filePath}:\n${issues.join("\n")}`;
}

export class Registry {
	private providers = new Map<string, ProviderConfig>();
	private benchmarks = new Map<string, BenchmarkConfig>();
	private basePath: string;

	constructor(basePath: string = ".") {
		this.basePath = basePath;
	}

	/**
	 * Discover and load all provider and benchmark configs.
	 */
	async discover(): Promise<void> {
		await Promise.all([this.discoverProviders(), this.discoverBenchmarks()]);
	}

	/**
	 * Discover and load provider configs from providers/configs (including subdirectories)
	 */
	private async discoverProviders(): Promise<void> {
		const pattern = `${this.basePath}/providers/configs/**/*.yaml`;
		const files = await glob(pattern);

		for (const file of files) {
			try {
				const content = await Bun.file(file).text();
				const raw = parse(content);
				const interpolated = interpolateEnvVarsInObject(raw);
				const config = ProviderConfigSchema.parse(interpolated);
				this.providers.set(config.name, config);
			} catch (error) {
				if (error instanceof ZodError) {
					console.error(formatZodError(error, file));
				} else {
					console.error(`Failed to load provider config from ${file}:`, error);
				}
			}
		}
	}

	/**
	 * Discover and load benchmark configs from benchmarks/configs/*.yaml
	 */
	private async discoverBenchmarks(): Promise<void> {
		const pattern = `${this.basePath}/benchmarks/configs/*.yaml`;
		const files = await glob(pattern);

		for (const file of files) {
			try {
				const content = await Bun.file(file).text();
				const raw = parse(content);
				const interpolated = interpolateEnvVarsInObject(raw);
				const config = BenchmarkConfigSchema.parse(interpolated);
				
				// Validate sealed semantics (fail fast if pack exists and YAML overrides)
				// Note: packId from YAML could be in a future "pack" field, but for now
				// we check if a pack exists for this benchmark name
				getPackAndValidate(config);
				
				this.benchmarks.set(config.name, config);
			} catch (error) {
				if (error instanceof ZodError) {
					console.error(formatZodError(error, file));
				} else {
					console.error(
						`Failed to load benchmark config from ${file}:`,
						error,
					);
				}
			}
		}
	}

	/**
	 * Get a provider config by name.
	 */
	getProvider(name: string): ProviderConfig {
		const config = this.providers.get(name);
		if (!config) {
			const available = Array.from(this.providers.keys()).join(", ");
			throw new Error(
				`Unknown provider: ${name}. Available providers: ${available || "none"}`,
			);
		}
		return config;
	}

	/**
	 * Get a benchmark config by name.
	 */
	getBenchmark(name: string): BenchmarkConfig {
		const config = this.benchmarks.get(name);
		if (!config) {
			const available = Array.from(this.benchmarks.keys()).join(", ");
			throw new Error(
				`Unknown benchmark: ${name}. Available benchmarks: ${available || "none"}`,
			);
		}
		return config;
	}

	/**
	 * Get a benchmark pack for a benchmark (if exists).
	 * Validates sealed semantics.
	 */
	getBenchmarkPack(benchmarkName: string, packId?: string): import("../benchmarks/packs/interface.ts").BenchmarkPack | undefined {
		const config = this.getBenchmark(benchmarkName);
		return getPackAndValidate(config, packId);
	}

	/**
	 * List all registered providers.
	 */
	listProviders(options?: { tags?: string[] }): ProviderConfig[] {
		let providers = Array.from(this.providers.values());

		if (options?.tags && options.tags.length > 0) {
			providers = providers.filter((p) =>
				options.tags!.some((tag) => p.tags?.includes(tag)),
			);
		}

		return providers;
	}

	/**
	 * List all registered benchmarks.
	 */
	listBenchmarks(options?: { tags?: string[] }): BenchmarkConfig[] {
		let benchmarks = Array.from(this.benchmarks.values());

		if (options?.tags && options.tags.length > 0) {
			benchmarks = benchmarks.filter((b) =>
				options.tags!.some((tag) => b.tags?.includes(tag)),
			);
		}

		return benchmarks;
	}

	/**
	 * Check if a provider exists.
	 */
	hasProvider(name: string): boolean {
		return this.providers.has(name);
	}

	/**
	 * Check if a benchmark exists.
	 */
	hasBenchmark(name: string): boolean {
		return this.benchmarks.has(name);
	}

	/**
	 * Get provider names.
	 */
	getProviderNames(): string[] {
		return Array.from(this.providers.keys());
	}

	/**
	 * Get benchmark names.
	 */
	getBenchmarkNames(): string[] {
		return Array.from(this.benchmarks.keys());
	}

	/**
	 * Register a provider config programmatically (useful for testing).
	 */
	registerProvider(config: ProviderConfig): void {
		this.providers.set(config.name, config);
	}

	/**
	 * Register a benchmark config programmatically (useful for testing).
	 */
	registerBenchmark(config: BenchmarkConfig): void {
		this.benchmarks.set(config.name, config);
	}
}

// Singleton instance for convenience
let globalRegistry: Registry | null = null;

export async function getRegistry(basePath?: string): Promise<Registry> {
	if (!globalRegistry) {
		globalRegistry = new Registry(basePath);
		await globalRegistry.discover();
	}
	return globalRegistry;
}

export function resetRegistry(): void {
	globalRegistry = null;
}

