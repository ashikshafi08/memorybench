/**
 * File Recall@K metric calculator.
 *
 * Measures what fraction of ground-truth files are covered by retrieved chunks.
 * Designed for SWE-bench Lite and similar file-level retrieval benchmarks.
 *
 * This metric is different from standard recall:
 * - Standard recall: fraction of relevant items retrieved
 * - File recall: fraction of target files that have at least one chunk retrieved
 *
 * Uses metadata.modifiedFiles from the item as ground truth.
 */

import type { EvalResult, SearchResult } from "../../config.ts";
import type { MetricCalculator, MetricResult } from "../interface.ts";

/**
 * Normalize a file path for comparison.
 */
function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

/**
 * Check if two paths match (exact or suffix match).
 */
function pathMatches(path1: string, path2: string): boolean {
	const p1 = normalizePath(path1);
	const p2 = normalizePath(path2);
	return p1 === p2 || p1.endsWith(p2) || p2.endsWith(p1);
}

/**
 * Generic File Recall@K metric calculator.
 *
 * @param k - Number of top results to consider
 */
export class FileRecallAtKMetric implements MetricCalculator {
	readonly name: string;
	readonly aliases: readonly string[];
	readonly description: string;
	private readonly k: number;

	constructor(k: number) {
		this.k = k;
		this.name = `file_recall_at_${k}`;
		this.aliases = [`file_recall@${k}`, `fr@${k}`] as const;
		this.description = `File-level recall at top ${k} results`;
	}

	compute(results: EvalResult[]): MetricResult {
		if (results.length === 0) {
			return { name: this.name, value: 0 };
		}

		let totalFileRecall = 0;
		let itemsWithGroundTruth = 0;
		let totalModifiedFiles = 0;
		let totalCoveredFiles = 0;

		for (const result of results) {
			// Get modified files from metadata
			const modifiedFiles = this.getModifiedFiles(result);
			if (modifiedFiles.length === 0) {
				continue;
			}

			itemsWithGroundTruth++;
			totalModifiedFiles += modifiedFiles.length;

			// Get retrieved chunks (limited to k)
			const retrievedContext = result.retrievedContext.slice(0, this.k);

			// Get unique files from retrieved chunks
			const retrievedFiles = new Set<string>();
			for (const ctx of retrievedContext) {
				const filepath = this.getFilepath(ctx);
				if (filepath) {
					retrievedFiles.add(normalizePath(filepath));
				}
			}

			// Count how many modified files are covered
			let covered = 0;
			for (const modifiedFile of modifiedFiles) {
				const normalizedModified = normalizePath(modifiedFile);
				const isCovered = Array.from(retrievedFiles).some((retrieved) =>
					pathMatches(retrieved, normalizedModified),
				);
				if (isCovered) {
					covered++;
				}
			}

			totalCoveredFiles += covered;
			totalFileRecall += covered / modifiedFiles.length;
		}

		if (itemsWithGroundTruth === 0) {
			return {
				name: this.name,
				value: 0,
				details: {
					error: "No items with modifiedFiles metadata",
				},
			};
		}

		return {
			name: this.name,
			value: totalFileRecall / itemsWithGroundTruth,
			details: {
				avgFileRecall: totalFileRecall / itemsWithGroundTruth,
				totalModifiedFiles,
				totalCoveredFiles,
				itemsWithGroundTruth,
				total: results.length,
				k: this.k,
			},
		};
	}

	/**
	 * Extract modified files from result metadata.
	 */
	private getModifiedFiles(result: EvalResult): string[] {
		const files = result.metadata?.modifiedFiles;
		if (Array.isArray(files)) {
			return files.filter((f): f is string => typeof f === "string");
		}
		return [];
	}

	/**
	 * Extract filepath from search result.
	 */
	private getFilepath(result: SearchResult): string | null {
		const filepath = result.metadata?.filepath as string | undefined;
		return filepath || null;
	}
}

// Pre-built instances for common K values
export class FileRecallAt5Metric extends FileRecallAtKMetric {
	constructor() {
		super(5);
	}
}

export class FileRecallAt10Metric extends FileRecallAtKMetric {
	constructor() {
		super(10);
	}
}
