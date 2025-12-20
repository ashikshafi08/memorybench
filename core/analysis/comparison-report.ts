/**
 * Comparison Report Generator
 *
 * Generates comprehensive comparison reports for benchmark results,
 * including statistical significance testing across providers.
 */

import type { EvalResult } from "../config.ts";
import {
	bootstrapCI,
	compareSystemsPaired,
	formatComparisonResult,
	type BootstrapCI,
	type ComparisonResult,
	type ItemScore,
} from "./statistics.ts";

/**
 * Provider benchmark results.
 */
export interface ProviderResults {
	/** Provider name */
	provider: string;
	/** Benchmark name */
	benchmark: string;
	/** Per-item results */
	results: EvalResult[];
	/** Aggregate metrics */
	metrics: Record<string, number>;
}

/**
 * Comparison report for a single metric.
 */
export interface MetricComparison {
	/** Metric name */
	metric: string;
	/** Per-provider statistics */
	providers: Array<{
		provider: string;
		mean: number;
		std: number;
		ci95: [number, number];
		n: number;
	}>;
	/** Pairwise comparisons */
	pairwise: ComparisonResult[];
	/** Best provider for this metric */
	best: string;
}

/**
 * Full comparison report.
 */
export interface ComparisonReport {
	/** Benchmark name */
	benchmark: string;
	/** Metrics analyzed */
	metrics: MetricComparison[];
	/** Summary table */
	summary: string[][];
	/** Generated timestamp */
	timestamp: string;
}

/**
 * Extract per-item scores for a metric from results.
 */
function extractItemScores(
	results: EvalResult[],
	metric: string,
): ItemScore[] {
	const scores: ItemScore[] = [];

	for (const result of results) {
		const itemId = result.itemId;
		let score: number | undefined;

		// Try to find the metric value
		switch (metric) {
			case "accuracy":
				score = result.correct ? 1 : 0;
				break;
			case "score":
				score = result.score;
				break;
			default:
				// Check if it's stored in result metadata
				if (result.metadata?.[metric] !== undefined) {
					score = result.metadata[metric] as number;
				} else {
					// For retrieval metrics, use score as proxy
					score = result.score;
				}
		}

		if (score !== undefined && itemId) {
			scores.push({ id: itemId, score });
		}
	}

	return scores;
}

/**
 * Compare multiple providers on a single benchmark.
 */
export function compareProviders(
	providerResults: ProviderResults[],
	metricsToCompare: string[] = ["accuracy", "ndcg_at_10", "recall_at_10", "mrr"],
): ComparisonReport {
	if (providerResults.length === 0) {
		return {
			benchmark: "",
			metrics: [],
			summary: [],
			timestamp: new Date().toISOString(),
		};
	}

	const benchmark = providerResults[0]!.benchmark;
	const metricComparisons: MetricComparison[] = [];

	for (const metric of metricsToCompare) {
		// Compute per-provider statistics
		const providerStats: MetricComparison["providers"] = [];
		const allScores: Map<string, ItemScore[]> = new Map();

		for (const pr of providerResults) {
			const scores = extractItemScores(pr.results, metric);
			allScores.set(pr.provider, scores);

			if (scores.length > 0) {
				const values = scores.map((s) => s.score);
				const ci = bootstrapCI(values);

				providerStats.push({
					provider: pr.provider,
					mean: ci.mean,
					std: ci.std,
					ci95: [ci.lower, ci.upper],
					n: scores.length,
				});
			}
		}

		// Pairwise comparisons
		const pairwise: ComparisonResult[] = [];
		const providers = [...allScores.keys()];

		for (let i = 0; i < providers.length; i++) {
			for (let j = i + 1; j < providers.length; j++) {
				const provA = providers[i]!;
				const provB = providers[j]!;
				const scoresA = allScores.get(provA) || [];
				const scoresB = allScores.get(provB) || [];

				if (scoresA.length > 0 && scoresB.length > 0) {
					const comparison = compareSystemsPaired(
						provA,
						provB,
						scoresA,
						scoresB,
						metric,
					);
					pairwise.push(comparison);
				}
			}
		}

		// Find best provider
		let best = "";
		let bestMean = -Infinity;
		for (const ps of providerStats) {
			if (ps.mean > bestMean) {
				bestMean = ps.mean;
				best = ps.provider;
			}
		}

		metricComparisons.push({
			metric,
			providers: providerStats,
			pairwise,
			best,
		});
	}

	// Generate summary table
	const summary = generateSummaryTable(providerResults, metricComparisons);

	return {
		benchmark,
		metrics: metricComparisons,
		summary,
		timestamp: new Date().toISOString(),
	};
}

/**
 * Generate a summary table as 2D array.
 */
function generateSummaryTable(
	providerResults: ProviderResults[],
	metricComparisons: MetricComparison[],
): string[][] {
	const providers = providerResults.map((pr) => pr.provider);
	const metrics = metricComparisons.map((mc) => mc.metric);

	// Header row
	const header = ["Provider", ...metrics];
	const rows: string[][] = [header];

	// Data rows
	for (const provider of providers) {
		const row = [provider];
		for (const mc of metricComparisons) {
			const ps = mc.providers.find((p) => p.provider === provider);
			if (ps) {
				const marker = mc.best === provider ? "**" : "";
				row.push(`${marker}${ps.mean.toFixed(4)}${marker}`);
			} else {
				row.push("N/A");
			}
		}
		rows.push(row);
	}

	return rows;
}

/**
 * Format comparison report as markdown.
 */
export function formatReportMarkdown(report: ComparisonReport): string {
	const lines: string[] = [];

	lines.push(`# Comparison Report: ${report.benchmark}`);
	lines.push(`\n*Generated: ${report.timestamp}*\n`);

	// Summary table
	lines.push("## Summary\n");
	if (report.summary.length > 0) {
		// Create markdown table
		const header = report.summary[0]!;
		lines.push("| " + header.join(" | ") + " |");
		lines.push("| " + header.map(() => "---").join(" | ") + " |");
		for (let i = 1; i < report.summary.length; i++) {
			lines.push("| " + report.summary[i]!.join(" | ") + " |");
		}
	}
	lines.push("");

	// Detailed metrics
	lines.push("## Detailed Analysis\n");
	for (const mc of report.metrics) {
		lines.push(`### ${mc.metric}\n`);
		lines.push(`**Best provider:** ${mc.best}\n`);

		// Provider stats
		lines.push("**Per-provider statistics:**\n");
		for (const ps of mc.providers) {
			lines.push(
				`- ${ps.provider}: mean=${ps.mean.toFixed(4)}, std=${ps.std.toFixed(4)}, ` +
					`95% CI=[${ps.ci95[0].toFixed(4)}, ${ps.ci95[1].toFixed(4)}], n=${ps.n}`,
			);
		}
		lines.push("");

		// Pairwise comparisons
		if (mc.pairwise.length > 0) {
			lines.push("**Pairwise comparisons:**\n");
			for (const pw of mc.pairwise) {
				const sig = pw.significant ? "✓" : "✗";
				lines.push(
					`- ${pw.systemA} vs ${pw.systemB}: Δ=${pw.difference >= 0 ? "+" : ""}${pw.difference.toFixed(4)}, ` +
						`p=${pw.pValue.toFixed(4)} ${sig}, d=${pw.effectSize.toFixed(3)} (${pw.effectMagnitude})`,
				);
			}
			lines.push("");
		}
	}

	return lines.join("\n");
}

/**
 * Format comparison report as plain text.
 */
export function formatReportText(report: ComparisonReport): string {
	const lines: string[] = [];

	lines.push(`=== Comparison Report: ${report.benchmark} ===`);
	lines.push(`Generated: ${report.timestamp}\n`);

	// Summary
	lines.push("SUMMARY:");
	lines.push("-".repeat(60));
	if (report.summary.length > 0) {
		const colWidths = report.summary[0]!.map((_, i) =>
			Math.max(...report.summary.map((row) => (row[i] || "").length)),
		);

		for (const row of report.summary) {
			const formatted = row.map((cell, i) => cell.padEnd(colWidths[i]!));
			lines.push(formatted.join("  "));
		}
	}
	lines.push("");

	// Detailed metrics
	for (const mc of report.metrics) {
		lines.push(`\n${mc.metric.toUpperCase()}`);
		lines.push("-".repeat(40));
		lines.push(`Best: ${mc.best}\n`);

		for (const pw of mc.pairwise) {
			lines.push(formatComparisonResult(pw));
			lines.push("");
		}
	}

	return lines.join("\n");
}

/**
 * Format comparison report as JSON.
 */
export function formatReportJSON(report: ComparisonReport): string {
	return JSON.stringify(report, null, 2);
}
