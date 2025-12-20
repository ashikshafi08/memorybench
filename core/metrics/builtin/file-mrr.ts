/**
 * File-Level Mean Reciprocal Rank (File-MRR) metric calculator.
 *
 * Measures how quickly the first relevant FILE is retrieved among unique files.
 * Designed for SWE-bench Lite and similar file-level retrieval benchmarks.
 *
 * This metric is different from standard MRR:
 * - Standard MRR: rank of first relevant chunk
 * - File-MRR: rank of first relevant file (among unique files)
 *
 * Uses metadata.modifiedFiles (or groundTruthFiles) from the item as ground truth.
 *
 * Formula:
 *   File-MRR = (1/N) * sum(1 / file_rank_i)
 *   where file_rank_i is the position of the first relevant file (1-indexed)
 *   among unique files in the retrieved results for query i
 */

import type { EvalResult, SearchResult } from "../../config.ts";
import type { MetricCalculator, MetricResult } from "../interface.ts";
import { normalizePath, pathMatches } from "../../../benchmarks/packs/relevance.ts";

/**
 * File-Level Mean Reciprocal Rank metric calculator.
 */
export class FileMRRMetric implements MetricCalculator {
	readonly name = "file_mrr";
	readonly aliases = ["file-mrr", "fmrr"] as const;
	readonly description =
		"Mean Reciprocal Rank at file level - average of 1/rank for first relevant file";

	compute(results: EvalResult[]): MetricResult {
		if (results.length === 0) {
			return { name: this.name, value: 0 };
		}

		let totalReciprocalRank = 0;
		let itemsWithGroundTruth = 0;
		let foundCount = 0;

		for (const result of results) {
			// Get ground truth files from metadata
			const gtFiles = this.getGroundTruthFiles(result);
			if (gtFiles.length === 0) {
				continue;
			}

			itemsWithGroundTruth++;

			// Normalize ground truth files for comparison
			const gtNormalized = gtFiles.map(normalizePath);

			// Find rank of first relevant file among unique files
			const seenFiles = new Set<string>();
			let foundRank = -1;

			for (const ctx of result.retrievedContext) {
				const filepath = this.getFilepath(ctx);
				if (!filepath) continue;

				const normalizedFilepath = normalizePath(filepath);

				// Skip if we've already seen this file
				if (seenFiles.has(normalizedFilepath)) continue;
				seenFiles.add(normalizedFilepath);

				// Check if this file is relevant (use pathMatches for suffix matching)
				for (const gt of gtNormalized) {
					if (pathMatches(normalizedFilepath, gt)) {
						foundRank = seenFiles.size; // 1-indexed rank among unique files
						break;
					}
				}

				if (foundRank > 0) break;
			}

			if (foundRank > 0) {
				totalReciprocalRank += 1 / foundRank;
				foundCount++;
			}
		}

		if (itemsWithGroundTruth === 0) {
			return {
				name: this.name,
				value: 0,
				details: {
					error: "No items with modifiedFiles or groundTruthFiles metadata",
				},
			};
		}

		return {
			name: this.name,
			value: totalReciprocalRank / itemsWithGroundTruth,
			details: {
				foundCount,
				itemsWithGroundTruth,
				total: results.length,
			},
		};
	}

	/**
	 * Extract ground truth files from result metadata.
	 * Supports multiple field names for compatibility.
	 */
	private getGroundTruthFiles(result: EvalResult): string[] {
		const metadata = result.metadata;
		if (!metadata) return [];

		// Support both field names for compatibility
		const files = metadata.modifiedFiles ?? metadata.groundTruthFiles;
		if (Array.isArray(files)) {
			return files.filter((f): f is string => typeof f === "string");
		}
		return [];
	}

	/**
	 * Extract filepath from search result.
	 */
	private getFilepath(result: SearchResult): string | null {
		// Try metadata.filepath first
		const filepath = result.metadata?.filepath as string | undefined;
		if (filepath) return filepath;

		// Fallback: extract from chunk ID (format: "filepath:linerange")
		if (result.id && result.id.includes(":")) {
			return result.id.split(":")[0]!;
		}

		return null;
	}
}
