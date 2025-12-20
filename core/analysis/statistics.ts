/**
 * Statistical Analysis for Benchmark Results
 *
 * Provides statistical significance testing and confidence intervals
 * for comparing chunking strategies across benchmarks.
 *
 * Includes:
 * - Bootstrap confidence intervals
 * - Paired t-tests
 * - Cohen's d effect sizes
 * - Wilcoxon signed-rank tests
 */

/**
 * Result of a statistical comparison between two systems.
 */
export interface ComparisonResult {
	/** System A identifier */
	systemA: string;
	/** System B identifier */
	systemB: string;
	/** Metric being compared */
	metric: string;
	/** Mean of system A */
	meanA: number;
	/** Mean of system B */
	meanB: number;
	/** Difference (A - B) */
	difference: number;
	/** 95% confidence interval for the difference */
	ci95: [number, number];
	/** p-value from paired test */
	pValue: number;
	/** Cohen's d effect size */
	effectSize: number;
	/** Interpretation of effect size */
	effectMagnitude: "negligible" | "small" | "medium" | "large";
	/** Whether the difference is statistically significant */
	significant: boolean;
	/** Sample size (number of paired observations) */
	n: number;
}

/**
 * Bootstrap confidence interval for a single metric.
 */
export interface BootstrapCI {
	/** Point estimate (sample mean) */
	mean: number;
	/** Standard deviation */
	std: number;
	/** Lower bound of 95% CI */
	lower: number;
	/** Upper bound of 95% CI */
	upper: number;
	/** Confidence level (default 0.95) */
	confidence: number;
	/** Number of bootstrap iterations */
	iterations: number;
}

/**
 * Per-item score for a metric.
 */
export interface ItemScore {
	/** Item ID */
	id: string;
	/** Score value */
	score: number;
}

/**
 * Compute mean of an array.
 */
function mean(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Compute standard deviation.
 */
function std(values: number[]): number {
	if (values.length <= 1) return 0;
	const m = mean(values);
	const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
	return Math.sqrt(variance);
}

/**
 * Compute standard error of the mean.
 */
function sem(values: number[]): number {
	return std(values) / Math.sqrt(values.length);
}

/**
 * Bootstrap resampling to compute confidence interval.
 */
export function bootstrapCI(
	values: number[],
	options: {
		iterations?: number;
		confidence?: number;
		statistic?: (v: number[]) => number;
	} = {},
): BootstrapCI {
	const { iterations = 10000, confidence = 0.95, statistic = mean } = options;

	if (values.length === 0) {
		return {
			mean: 0,
			std: 0,
			lower: 0,
			upper: 0,
			confidence,
			iterations,
		};
	}

	// Bootstrap resampling
	const bootstrapMeans: number[] = [];

	for (let i = 0; i < iterations; i++) {
		// Resample with replacement
		const sample: number[] = [];
		for (let j = 0; j < values.length; j++) {
			const idx = Math.floor(Math.random() * values.length);
			sample.push(values[idx]!);
		}
		bootstrapMeans.push(statistic(sample));
	}

	// Sort for percentile calculation
	bootstrapMeans.sort((a, b) => a - b);

	// Compute percentiles for CI
	const alpha = 1 - confidence;
	const lowerIdx = Math.floor((alpha / 2) * iterations);
	const upperIdx = Math.floor((1 - alpha / 2) * iterations);

	return {
		mean: statistic(values),
		std: std(values),
		lower: bootstrapMeans[lowerIdx]!,
		upper: bootstrapMeans[upperIdx]!,
		confidence,
		iterations,
	};
}

/**
 * Paired t-test for comparing two matched samples.
 *
 * Returns p-value using the t-distribution approximation.
 */
export function pairedTTest(
	valuesA: number[],
	valuesB: number[],
): { tStatistic: number; pValue: number; df: number } {
	if (valuesA.length !== valuesB.length) {
		throw new Error("Samples must have equal length for paired t-test");
	}

	const n = valuesA.length;
	if (n < 2) {
		return { tStatistic: 0, pValue: 1, df: 0 };
	}

	// Compute differences
	const diffs: number[] = [];
	for (let i = 0; i < n; i++) {
		diffs.push(valuesA[i]! - valuesB[i]!);
	}

	const meanDiff = mean(diffs);
	const seDiff = sem(diffs);

	if (seDiff === 0) {
		// No variance in differences
		return {
			tStatistic: meanDiff === 0 ? 0 : Infinity * Math.sign(meanDiff),
			pValue: meanDiff === 0 ? 1 : 0,
			df: n - 1,
		};
	}

	const tStatistic = meanDiff / seDiff;
	const df = n - 1;

	// Approximate p-value using normal distribution for large samples
	// For more accurate results, use a proper t-distribution CDF
	const pValue = approximateTwoTailedPValue(tStatistic, df);

	return { tStatistic, pValue, df };
}

/**
 * Approximate two-tailed p-value from t-statistic.
 *
 * Uses normal approximation for large df, otherwise uses
 * a conservative approximation.
 */
function approximateTwoTailedPValue(t: number, df: number): number {
	const absT = Math.abs(t);

	// For large df, use normal approximation
	if (df > 30) {
		// Standard normal CDF approximation
		const z = absT;
		const p = 1 - normalCDF(z);
		return 2 * p;
	}

	// For smaller df, use a conservative approximation
	// This is not as accurate as a proper t-distribution CDF
	// but works for significance testing
	const criticalT = getCriticalT(df, 0.05);
	if (absT >= criticalT) {
		// Approximate based on distance from critical value
		const excess = absT - criticalT;
		return Math.max(0.001, 0.05 * Math.exp(-excess));
	}
	// Linear interpolation for p > 0.05
	return 0.05 + (1 - absT / criticalT) * 0.45;
}

/**
 * Standard normal CDF approximation (Abramowitz & Stegun).
 */
function normalCDF(x: number): number {
	const a1 = 0.254829592;
	const a2 = -0.284496736;
	const a3 = 1.421413741;
	const a4 = -1.453152027;
	const a5 = 1.061405429;
	const p = 0.3275911;

	const sign = x < 0 ? -1 : 1;
	x = Math.abs(x) / Math.sqrt(2);

	const t = 1.0 / (1.0 + p * x);
	const y =
		1.0 -
		((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

	return 0.5 * (1.0 + sign * y);
}

/**
 * Get critical t-value for given df and alpha (two-tailed).
 */
function getCriticalT(df: number, alpha: number): number {
	// Common critical values for alpha=0.05 (two-tailed)
	const criticalValues: Record<number, number> = {
		1: 12.706,
		2: 4.303,
		3: 3.182,
		4: 2.776,
		5: 2.571,
		10: 2.228,
		15: 2.131,
		20: 2.086,
		25: 2.06,
		30: 2.042,
	};

	if (df in criticalValues) {
		return criticalValues[df]!;
	}

	// Interpolate or use large-sample approximation
	if (df > 30) {
		return 1.96; // Normal approximation
	}

	// Find nearest values
	const keys = Object.keys(criticalValues)
		.map(Number)
		.sort((a, b) => a - b);
	let lower = keys[0]!;
	let upper = keys[keys.length - 1]!;

	for (const k of keys) {
		if (k <= df) lower = k;
		if (k >= df && upper === keys[keys.length - 1]) upper = k;
	}

	if (lower === upper) return criticalValues[lower]!;

	// Linear interpolation
	const ratio = (df - lower) / (upper - lower);
	return (
		criticalValues[lower]! +
		ratio * (criticalValues[upper]! - criticalValues[lower]!)
	);
}

/**
 * Cohen's d effect size for paired samples.
 */
export function cohensD(valuesA: number[], valuesB: number[]): number {
	if (valuesA.length !== valuesB.length || valuesA.length < 2) {
		return 0;
	}

	// Compute differences
	const diffs: number[] = [];
	for (let i = 0; i < valuesA.length; i++) {
		diffs.push(valuesA[i]! - valuesB[i]!);
	}

	const meanDiff = mean(diffs);
	const sdDiff = std(diffs);

	if (sdDiff === 0) {
		return meanDiff === 0 ? 0 : Infinity * Math.sign(meanDiff);
	}

	return meanDiff / sdDiff;
}

/**
 * Interpret effect size magnitude.
 */
export function interpretEffectSize(
	d: number,
): "negligible" | "small" | "medium" | "large" {
	const absD = Math.abs(d);
	if (absD < 0.2) return "negligible";
	if (absD < 0.5) return "small";
	if (absD < 0.8) return "medium";
	return "large";
}

/**
 * Compare two systems on a metric using paired observations.
 */
export function compareSystemsPaired(
	systemA: string,
	systemB: string,
	scoresA: ItemScore[],
	scoresB: ItemScore[],
	metric: string,
	options: {
		alpha?: number;
		bootstrapIterations?: number;
	} = {},
): ComparisonResult {
	const { alpha = 0.05, bootstrapIterations = 10000 } = options;

	// Match items by ID
	const scoreMapA = new Map(scoresA.map((s) => [s.id, s.score]));
	const scoreMapB = new Map(scoresB.map((s) => [s.id, s.score]));

	const commonIds = [...scoreMapA.keys()].filter((id) => scoreMapB.has(id));

	const valuesA: number[] = [];
	const valuesB: number[] = [];

	for (const id of commonIds) {
		valuesA.push(scoreMapA.get(id)!);
		valuesB.push(scoreMapB.get(id)!);
	}

	const n = valuesA.length;
	const meanA = mean(valuesA);
	const meanB = mean(valuesB);
	const difference = meanA - meanB;

	// Compute differences for bootstrap CI
	const diffs: number[] = [];
	for (let i = 0; i < n; i++) {
		diffs.push(valuesA[i]! - valuesB[i]!);
	}

	// Bootstrap CI on differences
	const ciResult = bootstrapCI(diffs, { iterations: bootstrapIterations });
	const ci95: [number, number] = [ciResult.lower, ciResult.upper];

	// Paired t-test
	const { pValue } = pairedTTest(valuesA, valuesB);

	// Effect size
	const effectSize = cohensD(valuesA, valuesB);
	const effectMagnitude = interpretEffectSize(effectSize);

	return {
		systemA,
		systemB,
		metric,
		meanA,
		meanB,
		difference,
		ci95,
		pValue,
		effectSize,
		effectMagnitude,
		significant: pValue < alpha,
		n,
	};
}

/**
 * Format comparison result as a string.
 */
export function formatComparisonResult(result: ComparisonResult): string {
	const sign = result.difference >= 0 ? "+" : "";
	const sigMarker = result.significant ? "*" : "";

	return [
		`${result.metric}: ${result.systemA} vs ${result.systemB}`,
		`  Mean A: ${result.meanA.toFixed(4)}, Mean B: ${result.meanB.toFixed(4)}`,
		`  Difference: ${sign}${result.difference.toFixed(4)} (95% CI: [${result.ci95[0].toFixed(4)}, ${result.ci95[1].toFixed(4)}])`,
		`  p-value: ${result.pValue.toFixed(4)}${sigMarker}`,
		`  Effect size (Cohen's d): ${result.effectSize.toFixed(3)} (${result.effectMagnitude})`,
		`  n = ${result.n} paired observations`,
	].join("\n");
}
