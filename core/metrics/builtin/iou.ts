/**
 * IoU@K (Intersection over Union) metric calculators.
 * 
 * Measures how precisely retrieved chunks align with ground truth line ranges.
 * This is specific to code retrieval benchmarks where ground truth has line numbers.
 * 
 * Unlike recall (binary: is there a relevant chunk?), IoU measures QUALITY of alignment:
 * - IoU = 1.0: Chunk exactly matches ground truth lines
 * - IoU = 0.5: Chunk covers 50% of ground truth with 50% extra lines
 * - IoU = 0.0: No overlap with ground truth
 * 
 * Use cases:
 * - Comparing chunking strategies (AST vs fixed-size)
 * - Evaluating chunk boundary precision
 * - Identifying over-chunking vs under-chunking
 */

import type { EvalResult, SearchResult } from "../../config.ts";
import type { MetricCalculator, MetricResult } from "../interface.ts";

/**
 * Compute IoU between two line ranges.
 */
function lineRangeIoU(
	chunkStart: number,
	chunkEnd: number,
	targetStart: number,
	targetEnd: number,
): number {
	const intersectionStart = Math.max(chunkStart, targetStart);
	const intersectionEnd = Math.min(chunkEnd, targetEnd);

	if (intersectionStart > intersectionEnd) {
		return 0; // No overlap
	}

	const intersection = intersectionEnd - intersectionStart + 1;
	const chunkSize = chunkEnd - chunkStart + 1;
	const targetSize = targetEnd - targetStart + 1;
	const union = chunkSize + targetSize - intersection;

	return union > 0 ? intersection / union : 0;
}

/**
 * Extract line range from chunk metadata.
 */
function getChunkLineRange(chunk: SearchResult): { start: number; end: number } | null {
	const meta = chunk.metadata;
	if (!meta) return null;

	const startLine = meta.startLine as number | undefined;
	const endLine = meta.endLine as number | undefined;

	if (startLine === undefined || endLine === undefined) return null;
	return { start: startLine, end: endLine };
}

/**
 * Check if chunk filepath matches target file.
 */
function fileMatches(chunkPath: string, targetPath: string): boolean {
	const normalize = (p: string) => p.toLowerCase().replace(/\\/g, "/").replace(/^\/+/, "");
	const normalized1 = normalize(chunkPath);
	const normalized2 = normalize(targetPath);
	
	return normalized1 === normalized2 || 
		normalized1.endsWith(normalized2) || 
		normalized2.endsWith(normalized1);
}

/**
 * Generic IoU@K metric calculator.
 * 
 * Computes average IoU of the best-matching chunk in top-K for each query.
 * Only considers chunks from the ground truth file.
 */
export class IoUAtKMetric implements MetricCalculator {
	readonly name: string;
	readonly aliases: readonly string[];
	readonly description: string;
	private readonly k: number;

	constructor(k: number) {
		this.k = k;
		this.name = `iou_at_${k}`;
		this.aliases = [`iou@${k}`] as const;
		this.description = `Average IoU of best chunk in top-${k} against ground truth lines`;
	}

	compute(results: EvalResult[]): MetricResult {
		if (results.length === 0) {
			return { name: this.name, value: 0 };
		}

		let totalIoU = 0;
		let validQueries = 0;
		let maxIoUSum = 0;
		let avgIoUSum = 0;
		const iouDistribution: number[] = [];

		for (const result of results) {
			// Get ground truth from metadata
			const gt = result.metadata?.groundTruth as {
				file?: string;
				startLine?: number;
				endLine?: number;
			} | undefined;

			if (!gt?.file || gt.startLine === undefined || gt.endLine === undefined) {
				// No ground truth line info - skip
				continue;
			}

			const retrievedContext = result.retrievedContext.slice(0, this.k);
			
			// Find best IoU among chunks from the target file
			let bestIoU = 0;
			let chunkIoUs: number[] = [];

			for (const chunk of retrievedContext) {
				const filepath = chunk.metadata?.filepath as string | undefined;
				if (!filepath) continue;

				// Only consider chunks from the ground truth file
				if (!fileMatches(filepath, gt.file)) continue;

				const lineRange = getChunkLineRange(chunk);
				if (!lineRange) continue;

				const iou = lineRangeIoU(
					lineRange.start,
					lineRange.end,
					gt.startLine,
					gt.endLine,
				);

				chunkIoUs.push(iou);
				if (iou > bestIoU) {
					bestIoU = iou;
				}
			}

			// Track metrics
			iouDistribution.push(bestIoU);
			maxIoUSum += bestIoU;
			if (chunkIoUs.length > 0) {
				avgIoUSum += chunkIoUs.reduce((a, b) => a + b, 0) / chunkIoUs.length;
			}
			totalIoU += bestIoU;
			validQueries++;
		}

		const avgBestIoU = validQueries > 0 ? totalIoU / validQueries : 0;

		// Compute IoU distribution stats
		const sorted = [...iouDistribution].sort((a, b) => a - b);
		const p25 = sorted[Math.floor(sorted.length * 0.25)] ?? 0;
		const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
		const p75 = sorted[Math.floor(sorted.length * 0.75)] ?? 0;

		return {
			name: this.name,
			value: avgBestIoU,
			details: {
				validQueries,
				totalQueries: results.length,
				k: this.k,
				avgBestIoU: avgBestIoU.toFixed(3),
				distribution: {
					p25: p25.toFixed(3),
					p50: p50.toFixed(3),
					p75: p75.toFixed(3),
				},
				interpretation: avgBestIoU >= 0.7 
					? "Excellent chunk alignment" 
					: avgBestIoU >= 0.5 
						? "Good chunk alignment" 
						: avgBestIoU >= 0.3 
							? "Moderate chunk alignment" 
							: "Poor chunk alignment (chunks too large or misaligned)",
			},
		};
	}
}

// Pre-built instances for common K values
export class IoUAt1Metric extends IoUAtKMetric {
	constructor() {
		super(1);
	}
}

export class IoUAt3Metric extends IoUAtKMetric {
	constructor() {
		super(3);
	}
}

export class IoUAt5Metric extends IoUAtKMetric {
	constructor() {
		super(5);
	}
}

export class IoUAt10Metric extends IoUAtKMetric {
	constructor() {
		super(10);
	}
}
