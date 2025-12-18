/**
 * Shared utilities for metric calculations.
 */

/**
 * Tokenize a string into lowercase words.
 * Removes punctuation and splits on whitespace.
 */
export function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^\w\s]/g, " ")
		.split(/\s+/)
		.filter((t) => t.length > 0);
}

/**
 * Compute F1 score from precision and recall.
 */
export function computeF1FromPR(precision: number, recall: number): number {
	if (precision + recall === 0) return 0;
	return (2 * precision * recall) / (precision + recall);
}

/**
 * Compute token-level F1 using set intersection (no duplicate counting).
 */
export function computeTokenF1(
	predictedTokens: string[],
	expectedTokens: string[],
): { f1: number; precision: number; recall: number } {
	if (predictedTokens.length === 0 && expectedTokens.length === 0) {
		return { f1: 1, precision: 1, recall: 1 };
	}
	if (predictedTokens.length === 0 || expectedTokens.length === 0) {
		return { f1: 0, precision: 0, recall: 0 };
	}

	const predictedSet = new Set(predictedTokens);
	const expectedSet = new Set(expectedTokens);

	let overlapCount = 0;
	for (const token of predictedSet) {
		if (expectedSet.has(token)) overlapCount++;
	}

	const precision = overlapCount / predictedSet.size;
	const recall = overlapCount / expectedSet.size;
	const f1 = computeF1FromPR(precision, recall);

	return { f1, precision, recall };
}

/**
 * Count occurrences of each token (for BLEU clipping).
 */
export function countTokens(tokens: string[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const token of tokens) {
		counts.set(token, (counts.get(token) ?? 0) + 1);
	}
	return counts;
}

/**
 * Compute the length of Longest Common Subsequence.
 * Space-optimized DP: O(min(m,n)) space.
 */
export function lcsLength(a: string[], b: string[]): number {
	if (a.length === 0 || b.length === 0) return 0;

	const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
	const m = shorter.length;
	const n = longer.length;

	let prev = new Array<number>(m + 1).fill(0);
	let curr = new Array<number>(m + 1).fill(0);

	for (let i = 1; i <= n; i++) {
		for (let j = 1; j <= m; j++) {
			const longerItem = longer[i - 1];
			const shorterItem = shorter[j - 1];
			if (longerItem === shorterItem) {
				curr[j] = (prev[j - 1] ?? 0) + 1;
			} else {
				curr[j] = Math.max(prev[j] ?? 0, curr[j - 1] ?? 0);
			}
		}
		[prev, curr] = [curr, prev];
	}

	return prev[m] ?? 0;
}
