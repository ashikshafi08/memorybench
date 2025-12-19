/**
 * Unit tests for nDCG@K metric calculator.
 *
 * Key test cases:
 * 1. Multiple relevant IDs: IDCG uses |relevantSet| not relevantInTopK
 * 2. Rank sensitivity: moving a relevant hit down lowers nDCG
 * 3. Edge cases: empty results → 0; totalRelevant=0 → 0
 * 4. Strategy detection: qrels vs token-fallback
 */

import { describe, expect, it } from "bun:test";
import { NDCGAtKMetric, NDCGAt5Metric, NDCGAt10Metric } from "./ndcg.ts";
import type { EvalResult, SearchResult } from "../../config.ts";

// Helper to create mock EvalResult
function createMockResult(
	overrides: Partial<EvalResult> & {
		retrievedContext: SearchResult[];
	},
): EvalResult {
	return {
		runId: "test-run",
		benchmark: "test-benchmark",
		provider: "test-provider",
		itemId: "item-1",
		question: "What is the answer?",
		expected: "the answer is correct",
		actual: "the answer is correct",
		score: 1,
		correct: true,
		metadata: {},
		...overrides,
	};
}

// Helper to create mock SearchResult
function createMockContext(id: string, content: string, score = 0.9): SearchResult {
	return { id, content, score };
}

describe("NDCGAtKMetric", () => {
	describe("Basic functionality", () => {
		it("returns 0 for empty results array", () => {
			const metric = new NDCGAtKMetric(5);
			const result = metric.compute([]);
			expect(result.name).toBe("ndcg_at_5");
			expect(result.value).toBe(0);
		});

		it("has correct name and aliases", () => {
			const metric5 = new NDCGAt5Metric();
			expect(metric5.name).toBe("ndcg_at_5");
			expect(metric5.aliases).toContain("ndcg@5");
			expect(metric5.aliases).toContain("ndcg_5");

			const metric10 = new NDCGAt10Metric();
			expect(metric10.name).toBe("ndcg_at_10");
			expect(metric10.aliases).toContain("ndcg@10");
		});
	});

	describe("Qrels-based relevance (Strategy A)", () => {
		it("uses explicit relevantIds from metadata", () => {
			const metric = new NDCGAtKMetric(5);

			// Ground truth: chunks a, b, c are relevant
			const evalResult = createMockResult({
				metadata: {
					relevantIds: ["chunk-a", "chunk-b", "chunk-c"],
				},
				retrievedContext: [
					createMockContext("chunk-a", "relevant content a"),
					createMockContext("chunk-b", "relevant content b"),
					createMockContext("chunk-x", "irrelevant content"),
					createMockContext("chunk-y", "irrelevant content"),
					createMockContext("chunk-z", "irrelevant content"),
				],
			});

			const result = metric.compute([evalResult]);

			// DCG = 1/log2(2) + 1/log2(3) + 0 + 0 + 0 = 1 + 0.63 = 1.63
			// IDCG = 1/log2(2) + 1/log2(3) + 1/log2(4) = 1 + 0.63 + 0.5 = 2.13
			// nDCG = 1.63 / 2.13 ≈ 0.765
			expect(result.value).toBeCloseTo(0.765, 2);
			expect(result.details?.strategyUsed).toBe("qrels");
		});

		it("supports relevantChunkIds as alternative field name", () => {
			const metric = new NDCGAtKMetric(3);

			const evalResult = createMockResult({
				metadata: {
					relevantChunkIds: ["chunk-a", "chunk-b"],
				},
				retrievedContext: [
					createMockContext("chunk-a", "relevant"),
					createMockContext("chunk-b", "relevant"),
					createMockContext("chunk-x", "irrelevant"),
				],
			});

			const result = metric.compute([evalResult]);

			// Perfect ranking: all relevant at top
			// DCG = 1/log2(2) + 1/log2(3) = 1 + 0.63 = 1.63
			// IDCG = same = 1.63
			// nDCG = 1.0
			expect(result.value).toBeCloseTo(1.0, 2);
		});

		it("IDCG uses full relevantSet size, not just relevantInTopK", () => {
			const metric = new NDCGAtKMetric(3);

			// 5 relevant items exist, but only 2 are retrieved in top-3
			const evalResult = createMockResult({
				metadata: {
					relevantIds: ["a", "b", "c", "d", "e"], // 5 relevant
				},
				retrievedContext: [
					createMockContext("a", "relevant"),
					createMockContext("x", "irrelevant"),
					createMockContext("b", "relevant"),
				],
			});

			const result = metric.compute([evalResult]);

			// DCG = 1/log2(2) + 0/log2(3) + 1/log2(4) = 1 + 0 + 0.5 = 1.5
			// IDCG = min(3, 5) = 3 items: 1/log2(2) + 1/log2(3) + 1/log2(4) = 2.13
			// nDCG = 1.5 / 2.13 ≈ 0.704
			expect(result.value).toBeCloseTo(0.704, 2);

			// If we incorrectly used relevantInTopK=2 for IDCG:
			// IDCG would be 1 + 0.63 = 1.63
			// nDCG would be 1.5 / 1.63 ≈ 0.92 (WRONG - inflated!)
			expect(result.value).toBeLessThan(0.75); // Verify not inflated
		});
	});

	describe("Rank sensitivity", () => {
		it("penalizes relevant items at lower positions", () => {
			const metric = new NDCGAtKMetric(5);

			// Scenario 1: Relevant item at position 1
			const result1 = createMockResult({
				metadata: { relevantIds: ["chunk-a"] },
				retrievedContext: [
					createMockContext("chunk-a", "relevant"), // pos 1
					createMockContext("chunk-x", "irrelevant"),
					createMockContext("chunk-y", "irrelevant"),
				],
			});

			// Scenario 2: Same relevant item at position 3
			const result2 = createMockResult({
				metadata: { relevantIds: ["chunk-a"] },
				retrievedContext: [
					createMockContext("chunk-x", "irrelevant"),
					createMockContext("chunk-y", "irrelevant"),
					createMockContext("chunk-a", "relevant"), // pos 3
				],
			});

			const ndcg1 = metric.compute([result1]).value;
			const ndcg2 = metric.compute([result2]).value;

			// Position 1: DCG = 1/log2(2) = 1, IDCG = 1, nDCG = 1.0
			// Position 3: DCG = 1/log2(4) = 0.5, IDCG = 1, nDCG = 0.5
			expect(ndcg1).toBeCloseTo(1.0, 2);
			expect(ndcg2).toBeCloseTo(0.5, 2);
			expect(ndcg1).toBeGreaterThan(ndcg2);
		});

		it("perfect ranking achieves nDCG = 1.0", () => {
			const metric = new NDCGAtKMetric(5);

			const evalResult = createMockResult({
				metadata: { relevantIds: ["a", "b", "c"] },
				retrievedContext: [
					createMockContext("a", "rel"),
					createMockContext("b", "rel"),
					createMockContext("c", "rel"),
					createMockContext("x", "irr"),
					createMockContext("y", "irr"),
				],
			});

			const result = metric.compute([evalResult]);
			expect(result.value).toBeCloseTo(1.0, 5);
		});
	});

	describe("Edge cases", () => {
		it("returns 0 when no relevant items exist (IDCG=0)", () => {
			const metric = new NDCGAtKMetric(5);

			const evalResult = createMockResult({
				metadata: { relevantIds: [] }, // Empty qrels
				retrievedContext: [
					createMockContext("a", "content"),
					createMockContext("b", "content"),
				],
			});

			const result = metric.compute([evalResult]);
			expect(result.value).toBe(0);
		});

		it("returns 0 when no items are retrieved", () => {
			const metric = new NDCGAtKMetric(5);

			const evalResult = createMockResult({
				metadata: { relevantIds: ["a", "b"] },
				retrievedContext: [], // No retrieved items
			});

			const result = metric.compute([evalResult]);
			expect(result.value).toBe(0);
		});

		it("handles retrieved items fewer than K", () => {
			const metric = new NDCGAtKMetric(10);

			const evalResult = createMockResult({
				metadata: { relevantIds: ["a"] },
				retrievedContext: [
					createMockContext("a", "relevant"),
					createMockContext("x", "irrelevant"),
				], // Only 2 items, K=10
			});

			const result = metric.compute([evalResult]);
			// DCG = 1/log2(2) = 1, IDCG = 1, nDCG = 1.0
			expect(result.value).toBeCloseTo(1.0, 2);
		});
	});

	describe("Token-based fallback (Strategy C)", () => {
		it("falls back to token-based relevance when no qrels", () => {
			const metric = new NDCGAtKMetric(3, 0.3);

			// No relevantIds in metadata, should use token overlap
			const evalResult = createMockResult({
				expected: "the answer is correct",
				metadata: {}, // No qrels
				retrievedContext: [
					createMockContext("a", "the answer is correct and complete"),
					createMockContext("b", "something completely different"),
					createMockContext("c", "correct answer here"),
				],
			});

			const result = metric.compute([evalResult]);

			expect(result.details?.strategyUsed).toBe("token-fallback");
			// Should find some relevant items via token overlap
			expect(result.value).toBeGreaterThan(0);
		});
	});

	describe("Aggregation across multiple queries", () => {
		it("averages nDCG across all queries", () => {
			const metric = new NDCGAtKMetric(3);

			const results = [
				// Query 1: Perfect ranking (nDCG = 1.0)
				createMockResult({
					itemId: "q1",
					metadata: { relevantIds: ["a"] },
					retrievedContext: [
						createMockContext("a", "rel"),
						createMockContext("x", "irr"),
					],
				}),
				// Query 2: No relevant retrieved (nDCG = 0)
				createMockResult({
					itemId: "q2",
					metadata: { relevantIds: ["a"] },
					retrievedContext: [
						createMockContext("x", "irr"),
						createMockContext("y", "irr"),
					],
				}),
			];

			const result = metric.compute(results);

			// Average of 1.0 and 0 = 0.5
			expect(result.value).toBeCloseTo(0.5, 2);
			expect(result.details?.total).toBe(2);
		});
	});

	describe("Matches code-chunk implementation", () => {
		it("produces same result as code-chunk/packages/eval/src/metrics.ts", () => {
			const metric = new NDCGAtKMetric(5);

			// Recreate exact scenario from code-chunk tests
			const relevantSet = new Set(["a", "b", "c"]);
			const retrievedIds = ["a", "x", "b", "y", "z"];

			const evalResult = createMockResult({
				metadata: { relevantIds: Array.from(relevantSet) },
				retrievedContext: retrievedIds.map((id) =>
					createMockContext(id, `content for ${id}`),
				),
			});

			const result = metric.compute([evalResult]);

			// Manual calculation matching code-chunk:
			// DCG = 1/log2(2) + 0/log2(3) + 1/log2(4) + 0/log2(5) + 0/log2(6)
			//     = 1 + 0 + 0.5 + 0 + 0 = 1.5
			// idealK = min(5, 3) = 3
			// IDCG = 1/log2(2) + 1/log2(3) + 1/log2(4)
			//      = 1 + 0.6309 + 0.5 = 2.1309
			// nDCG = 1.5 / 2.1309 = 0.704
			expect(result.value).toBeCloseTo(0.704, 2);
		});
	});
});
