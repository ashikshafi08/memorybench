/**
 * Table Generator: Reads results from ResultsStore and formats as benchmark table.
 *
 * Usage: memorybench table --run <runId> --benchmark <name> [--baseline code-chunk-fixed]
 *
 * Produces an ASCII table with:
 * - Metrics: nDCG@10, P@10, R@10 (span-level) or File-R@5, File-R@10, File-MRR (file-level)
 * - Statistics: 95% CI (±half-width), Cohen's d effect size, Bonferroni-corrected significance
 */

import { ResultsStore } from "../core/results.ts";
import { getDefaultRegistry, type MetricRegistry } from "../core/metrics/index.ts";
import { bootstrapCI, cohensD, pairedTTest } from "../core/analysis/statistics.ts";
import type { EvalResult } from "../core/config.ts";

// ============================================================================
// Constants: Provider ordering and display names
// ============================================================================

/**
 * Display order for providers (baseline last).
 */
const PROVIDER_ORDER = [
	"code-chunk-ast",
	"chonkie-code",
	"chonkie-recursive",
	"code-chunk-fixed",
];

/**
 * Display names for providers (shorter, publication-ready).
 */
const DISPLAY_NAMES: Record<string, string> = {
	"code-chunk-ast": "code-chunk",
	"code-chunk-fixed": "Fixed",
	"chonkie-code": "Chonkie",
	"chonkie-recursive": "Chonkie-R",
};

/**
 * Benchmark metadata for proper table headers and metric selection.
 */
interface BenchmarkMeta {
	category: "span-level" | "file-level";
	displayName: string;
	language: string;
	taskType: string;
	metrics: string[];
	metricLabels: string[];
}

const BENCHMARK_META: Record<string, BenchmarkMeta> = {
	repoeval: {
		category: "span-level",
		displayName: "RepoEval",
		language: "Python",
		taskType: "Function-level",
		metrics: ["ndcg_at_10", "precision_at_10", "recall_at_10"],
		metricLabels: ["nDCG@10", "P@10", "R@10"],
	},
	"swebench-lite": {
		category: "file-level",
		displayName: "SWE-bench Lite",
		language: "Python",
		taskType: "Bug localization",
		metrics: ["file_recall_at_5", "file_recall_at_10", "mrr"],
		metricLabels: ["File-R@5", "File-R@10", "MRR"],
	},
	"repobench-r": {
		category: "span-level",
		displayName: "RepoBench-R",
		language: "Python/Java",
		taskType: "Cross-file retrieval",
		metrics: ["ndcg_at_10", "precision_at_10", "recall_at_10"],
		metricLabels: ["nDCG@10", "P@10", "R@10"],
	},
};

/**
 * Get benchmark metadata, with sensible defaults for unknown benchmarks.
 */
function getBenchmarkMeta(benchmarkName: string): BenchmarkMeta {
	return BENCHMARK_META[benchmarkName] ?? {
		category: "span-level",
		displayName: benchmarkName,
		language: "Mixed",
		taskType: "Retrieval",
		metrics: ["ndcg_at_10", "precision_at_10", "recall_at_10"],
		metricLabels: ["nDCG@10", "P@10", "R@10"],
	};
}

// ============================================================================
// Per-item scoring and pairing
// ============================================================================

/**
 * Compute per-item scores for a metric, keyed by itemId.
 * Returns Map<itemId, score> for proper pairing in statistical tests.
 */
function computePerItemScores(
	results: EvalResult[],
	metricName: string,
	registry: MetricRegistry,
): Map<string, number> {
	const calculator = registry.get(metricName);
	if (!calculator) {
		throw new Error(`Unknown metric: ${metricName}`);
	}

	const scores = new Map<string, number>();

	// Compute metric for each result individually, keyed by itemId
	for (const result of results) {
		const singleItemResult = calculator.compute([result]);
		scores.set(result.itemId, singleItemResult.value);
	}

	return scores;
}

/**
 * Extract paired arrays from two score maps, matching by itemId.
 * Only includes items present in both maps.
 */
function extractPairedScores(
	scoresA: Map<string, number>,
	scoresB: Map<string, number>,
): { valuesA: number[]; valuesB: number[]; itemIds: string[] } {
	const valuesA: number[] = [];
	const valuesB: number[] = [];
	const itemIds: string[] = [];

	for (const [itemId, scoreA] of scoresA) {
		const scoreB = scoresB.get(itemId);
		if (scoreB !== undefined) {
			valuesA.push(scoreA);
			valuesB.push(scoreB);
			itemIds.push(itemId);
		}
	}

	return { valuesA, valuesB, itemIds };
}

// ============================================================================
// Significance markers
// ============================================================================

/**
 * Get significance marker using proper Bonferroni thresholds.
 * ** for p < 0.01/m, * for p < 0.05/m
 */
function getSignificanceMarker(pValue: number, m: number): string {
	const thresholdDstar = 0.01 / m; // ** threshold
	const thresholdStar = 0.05 / m; // * threshold

	if (pValue < thresholdDstar) return "**";
	if (pValue < thresholdStar) return "*";
	return "";
}

// ============================================================================
// Provider data structure
// ============================================================================

interface ProviderMetricData {
	mean: number;
	halfWidth: number;
	scoreMap: Map<string, number>;
}

interface ProviderData {
	provider: string;
	displayName: string;
	results: EvalResult[];
	metrics: Map<string, ProviderMetricData>;
}

// ============================================================================
// ASCII Table Formatter
// ============================================================================

function formatAsciiTable(
	providerData: ProviderData[],
	baseline: string,
	metricsToCompute: string[],
	metricLabels: string[],
	m: number,
	benchmarkMeta: BenchmarkMeta,
	policy?: string,
): void {
	const baselineData = providerData.find((p) => p.provider === baseline);
	if (!baselineData) {
		console.error(`Baseline provider "${baseline}" not found in results`);
		return;
	}

	// Calculate column widths DYNAMICALLY
	const providerColWidth = Math.max(
		14,
		...providerData.map((p) => p.displayName.length + 2),
	);
	const metricColWidth = 17; // "90.0 ± 1.2 **" = 13 chars + padding
	const effectColWidth = 9;

	// Build formatted rows
	const rows: {
		provider: string;
		metric1: string;
		metric2: string;
		metric3: string;
		effect: string;
	}[] = [];

	for (const pm of providerData) {
		const m1 = pm.metrics.get(metricsToCompute[0]!)!;
		const m2 = pm.metrics.get(metricsToCompute[1]!)!;
		const m3 = pm.metrics.get(metricsToCompute[2]!)!;

		// Effect size (Cohen's d on primary metric)
		let effectStr = "baseline";
		let m1Sig = "";
		let m2Sig = "";
		let m3Sig = "";

		if (pm.provider !== baseline) {
			// Compute effect size using paired scores (matched by itemId)
			const baselineM1 = baselineData.metrics.get(metricsToCompute[0]!)!;
			const { valuesA, valuesB } = extractPairedScores(
				m1.scoreMap,
				baselineM1.scoreMap,
			);
			const d = cohensD(valuesA, valuesB);
			effectStr = `d=${d.toFixed(2)}`;

			// Compute significance FOR EACH COLUMN
			const { pValue: pM1 } = pairedTTest(valuesA, valuesB);
			m1Sig = getSignificanceMarker(pM1, m);

			const baselineM2 = baselineData.metrics.get(metricsToCompute[1]!)!;
			const { valuesA: pA, valuesB: pB } = extractPairedScores(
				m2.scoreMap,
				baselineM2.scoreMap,
			);
			const { pValue: pM2 } = pairedTTest(pA, pB);
			m2Sig = getSignificanceMarker(pM2, m);

			const baselineM3 = baselineData.metrics.get(metricsToCompute[2]!)!;
			const { valuesA: rA, valuesB: rB } = extractPairedScores(
				m3.scoreMap,
				baselineM3.scoreMap,
			);
			const { pValue: pM3 } = pairedTTest(rA, rB);
			m3Sig = getSignificanceMarker(pM3, m);
		}

		// Format: mean ± halfWidth with per-column significance markers
		const m1Str = `${(m1.mean * 100).toFixed(1)} ± ${(m1.halfWidth * 100).toFixed(1)}${m1Sig}`;
		const m2Str = `${(m2.mean * 100).toFixed(1)} ± ${(m2.halfWidth * 100).toFixed(1)}${m2Sig}`;
		const m3Str = `${(m3.mean * 100).toFixed(1)} ± ${(m3.halfWidth * 100).toFixed(1)}${m3Sig}`;

		rows.push({
			provider: pm.displayName,
			metric1: m1Str,
			metric2: m2Str,
			metric3: m3Str,
			effect: effectStr,
		});
	}

	// Generate table with proper padding per column
	const totalWidth =
		providerColWidth + metricColWidth * 3 + effectColWidth + 10; // separators

	// Build header based on benchmark category
	const categoryLabel = benchmarkMeta.category === "file-level" 
		? "FILE-LEVEL RETRIEVAL" 
		: "SPAN-LEVEL RETRIEVAL";
	const policyLabel = policy ? `, ${policy}` : "";
	const headerText = `${categoryLabel} (${benchmarkMeta.displayName}, ${benchmarkMeta.language}, ${benchmarkMeta.taskType}${policyLabel})`;

	console.log("┌" + "─".repeat(totalWidth) + "┐");
	console.log(
		"│ " +
			headerText.padEnd(totalWidth - 2) +
			" │",
	);
	console.log("├" + "─".repeat(totalWidth) + "┤");

	// Header row - use metric labels from benchmark meta
	console.log(
		`│ ${"Chunker".padEnd(providerColWidth)} │ ${metricLabels[0]!.padEnd(metricColWidth)} │ ${metricLabels[1]!.padEnd(metricColWidth)} │ ${metricLabels[2]!.padEnd(metricColWidth)} │ ${"Effect".padEnd(effectColWidth)} │`,
	);
	console.log("├" + "─".repeat(totalWidth) + "┤");

	// Data rows
	for (const row of rows) {
		console.log(
			`│ ${row.provider.padEnd(providerColWidth)} │ ${row.metric1.padEnd(metricColWidth)} │ ${row.metric2.padEnd(metricColWidth)} │ ${row.metric3.padEnd(metricColWidth)} │ ${row.effect.padEnd(effectColWidth)} │`,
		);
	}

	// Footer with Bonferroni info
	console.log("├" + "─".repeat(totalWidth) + "┤");
	const baselineDisplayName = DISPLAY_NAMES[baseline] ?? baseline;
	console.log(
		`│ ${"** p < " + (0.01 / m).toFixed(4) + ", * p < " + (0.05 / m).toFixed(4) + " vs " + baselineDisplayName + " (Bonferroni, m=" + m + ")"}`.padEnd(
			totalWidth + 1,
		) + " │",
	);
	console.log("└" + "─".repeat(totalWidth) + "┘");
}

// ============================================================================
// Main table command
// ============================================================================

export async function tableCommand(options: {
	runId: string;
	benchmark?: string;
	baseline?: string;
	dbPath?: string;
}): Promise<void> {
	const {
		runId,
		benchmark,
		baseline = "code-chunk-fixed",
		dbPath = "./results/results.db",
	} = options;

	const store = new ResultsStore(dbPath);
	let allResults: EvalResult[];

	try {
		allResults = store.getRunResults(runId);
	} finally {
		store.close();
	}

	if (allResults.length === 0) {
		console.error(`\n❌ No results found for run ID: ${runId}\n`);
		return;
	}

	// Filter by benchmark (required to avoid mixing different benchmarks)
	const benchmarks = [...new Set(allResults.map((r) => r.benchmark))];
	if (benchmarks.length > 1 && !benchmark) {
		console.error(`\n❌ Run contains multiple benchmarks: ${benchmarks.join(", ")}`);
		console.error("   Use --benchmark <name> to select one.\n");
		return;
	}
	const targetBenchmark = benchmark ?? benchmarks[0]!;
	allResults = allResults.filter((r) => r.benchmark === targetBenchmark);

	if (allResults.length === 0) {
		console.error(`\n❌ No results found for benchmark "${targetBenchmark}"\n`);
		return;
	}

	// Group results by provider
	const byProvider = new Map<string, EvalResult[]>();
	for (const r of allResults) {
		const existing = byProvider.get(r.provider) ?? [];
		existing.push(r);
		byProvider.set(r.provider, existing);
	}

	// Get benchmark metadata for proper metrics and labels
	const benchmarkMeta = getBenchmarkMeta(targetBenchmark);
	const metricsToCompute = benchmarkMeta.metrics;
	const metricLabels = benchmarkMeta.metricLabels;

	// Extract policy from results metadata (use first result's policy)
	const firstResult = allResults[0];
	const policy = (firstResult?.metadata as { policy?: string })?.policy;

	// Compute metrics per provider
	const metricRegistry = getDefaultRegistry();
	const providerData: ProviderData[] = [];

	for (const [provider, results] of byProvider) {
		const metrics = new Map<string, ProviderMetricData>();

		for (const metricName of metricsToCompute) {
			// Compute per-item scores keyed by itemId for proper pairing
			const scoreMap = computePerItemScores(results, metricName, metricRegistry);
			const scores = [...scoreMap.values()];
			const ci = bootstrapCI(scores, { iterations: 10000 });

			metrics.set(metricName, {
				mean: ci.mean,
				halfWidth: (ci.upper - ci.lower) / 2, // ± value is half-width of 95% CI
				scoreMap, // Keep for paired stats
			});
		}

		const displayName = DISPLAY_NAMES[provider] ?? provider;
		providerData.push({ provider, displayName, results, metrics });
	}

	// Sort providers deterministically (baseline last)
	providerData.sort((a, b) => {
		const indexA = PROVIDER_ORDER.indexOf(a.provider);
		const indexB = PROVIDER_ORDER.indexOf(b.provider);
		return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
	});

	// Verify baseline exists
	if (!providerData.find((p) => p.provider === baseline)) {
		console.error(`\n❌ Baseline provider "${baseline}" not found in results.`);
		console.error(`   Available providers: ${providerData.map((p) => p.provider).join(", ")}\n`);
		return;
	}

	// Format table with per-column significance
	// m = number of non-baseline comparisons
	const m = providerData.length - 1;

	console.log(); // Empty line before table
	formatAsciiTable(providerData, baseline, metricsToCompute, metricLabels, m, benchmarkMeta, policy);
	console.log(); // Empty line after table
}
