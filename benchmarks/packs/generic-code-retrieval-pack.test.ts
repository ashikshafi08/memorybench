/**
 * Tests for Generic Code Retrieval Pack
 *
 * Tests the factory-created benchmark packs for all 4 datasets:
 * - RepoEval: Line-range overlap scoring
 * - RepoBench-R: Jaccard similarity scoring
 * - CrossCodeEval: Dependency file coverage scoring
 * - SWE-bench Lite: Modified file recall scoring
 */

import { describe, expect, it } from "bun:test";
import {
	createCodeRetrievalPack,
	repoEvalPack,
	repoBenchRPack,
	crossCodeEvalPack,
	sweBenchLitePack,
} from "./generic-code-retrieval-pack.ts";
import type { BenchmarkItem, SearchResult } from "../../core/config.ts";

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock BenchmarkItem with customizable metadata.
 */
function createMockItem(overrides: Partial<BenchmarkItem> = {}): BenchmarkItem {
	return {
		id: "test-item-1",
		question: "What function handles authentication?",
		answer: "auth_handler",
		contexts: [],
		metadata: {},
		...overrides,
	};
}

/**
 * Create a mock SearchResult with customizable metadata.
 */
function createMockResult(
	content: string,
	metadata: Record<string, unknown> = {},
	score = 0.9,
): SearchResult {
	return { id: `mock-${Date.now()}-${Math.random()}`, content, score, metadata };
}

// ============================================================================
// Factory Tests
// ============================================================================

describe("createCodeRetrievalPack", () => {
	it("creates pack for repoeval", () => {
		const pack = createCodeRetrievalPack("repoeval");
		expect(pack.benchmarkName).toBe("repoeval");
		expect(pack.packId).toBe("repoeval@chunking-v1");
	});

	it("creates pack for repobench-r", () => {
		const pack = createCodeRetrievalPack("repobench-r");
		expect(pack.benchmarkName).toBe("repobench-r");
		expect(pack.packId).toBe("repobench-r@chunking-v1");
	});

	it("creates pack for crosscodeeval", () => {
		const pack = createCodeRetrievalPack("crosscodeeval");
		expect(pack.benchmarkName).toBe("crosscodeeval");
		expect(pack.packId).toBe("crosscodeeval@chunking-v1");
	});

	it("creates pack for swebench-lite", () => {
		const pack = createCodeRetrievalPack("swebench-lite");
		expect(pack.benchmarkName).toBe("swebench-lite");
		expect(pack.packId).toBe("swebench-lite@chunking-v1");
	});

	it("throws for unknown dataset", () => {
		expect(() => createCodeRetrievalPack("unknown-dataset")).toThrow(
			"Unknown dataset: unknown-dataset",
		);
	});

	it("all packs have sealed semantics", () => {
		for (const name of ["repoeval", "repobench-r", "crosscodeeval", "swebench-lite"]) {
			const pack = createCodeRetrievalPack(name);
			expect(pack.sealedSemantics).toEqual({
				prompts: true,
				scoring: true,
				relevance: true,
			});
		}
	});
});

describe("buildAnswerPrompt", () => {
	it("returns question text with SHA-256 hash", () => {
		const item = createMockItem({ question: "How does this work?" });
		const prompt = repoEvalPack.buildAnswerPrompt({ item, retrieved: [], run: {} });

		expect(prompt.text).toBe("How does this work?");
		// Verify hash is a valid SHA-256 (64 hex chars)
		expect(prompt.sha256).toMatch(/^[a-f0-9]{64}$/);
	});

	it("produces consistent hashes", () => {
		const item = createMockItem({ question: "test question" });
		const prompt1 = repoEvalPack.buildAnswerPrompt({ item, retrieved: [], run: {} });
		const prompt2 = repoEvalPack.buildAnswerPrompt({ item, retrieved: [], run: {} });

		expect(prompt1.sha256).toBe(prompt2.sha256);
	});
});

describe("buildJudgePrompt", () => {
	it("returns undefined (no LLM judge needed)", () => {
		const item = createMockItem();
		const result = repoEvalPack.buildJudgePrompt?.({ item, run: {}, answer: "test" });
		expect(result).toBeUndefined();
	});
});

// ============================================================================
// RepoEval Pack Tests
// ============================================================================

describe("repoEvalPack", () => {
	describe("isRelevant", () => {
		it("returns true when chunk overlaps ground truth line range", () => {
			const item = createMockItem({
				metadata: {
					groundTruth: { file: "src/auth.py", startLine: 10, endLine: 20 },
				},
			});
			const result = createMockResult("def auth_handler():", {
				filepath: "src/auth.py",
				startLine: 15,
				endLine: 25,
			});

			expect(repoEvalPack.isRelevant({ item, result })).toBe(true);
		});

		it("returns false when chunk does not overlap", () => {
			const item = createMockItem({
				metadata: {
					groundTruth: { file: "src/auth.py", startLine: 10, endLine: 20 },
				},
			});
			const result = createMockResult("def other_function():", {
				filepath: "src/auth.py",
				startLine: 50,
				endLine: 60,
			});

			expect(repoEvalPack.isRelevant({ item, result })).toBe(false);
		});

		it("returns false when file does not match", () => {
			const item = createMockItem({
				metadata: {
					groundTruth: { file: "src/auth.py", startLine: 10, endLine: 20 },
				},
			});
			const result = createMockResult("def auth_handler():", {
				filepath: "src/other.py",
				startLine: 10,
				endLine: 20,
			});

			expect(repoEvalPack.isRelevant({ item, result })).toBe(false);
		});

		it("returns false when no ground truth metadata", () => {
			const item = createMockItem({ metadata: {} });
			const result = createMockResult("def auth_handler():", {
				filepath: "src/auth.py",
				startLine: 10,
				endLine: 20,
			});

			expect(repoEvalPack.isRelevant({ item, result })).toBe(false);
		});
	});

	describe("evaluate", () => {
		it("returns score=1 when relevant chunk in top-k", async () => {
			const item = createMockItem({
				metadata: {
					groundTruth: { file: "src/auth.py", startLine: 10, endLine: 20 },
				},
			});
			const retrieved = [
				createMockResult("unrelated code", { filepath: "src/other.py", startLine: 1, endLine: 10 }),
				createMockResult("def auth_handler():", { filepath: "src/auth.py", startLine: 15, endLine: 25 }),
			];

			const result = await repoEvalPack.evaluate({ item, retrieved, run: { topK: 10 } });

			expect(result.score).toBe(1);
			expect(result.correct).toBe(true);
			expect(result.answer).toContain("Found 1 relevant chunk");
		});

		it("returns score=0 when no relevant chunk in top-k", async () => {
			const item = createMockItem({
				metadata: {
					groundTruth: { file: "src/auth.py", startLine: 10, endLine: 20 },
				},
			});
			const retrieved = [
				createMockResult("unrelated code", { filepath: "src/other.py", startLine: 1, endLine: 10 }),
			];

			const result = await repoEvalPack.evaluate({ item, retrieved, run: { topK: 10 } });

			expect(result.score).toBe(0);
			expect(result.correct).toBe(false);
			expect(result.answer).toContain("No relevant chunks");
		});

		it("respects topK limit", async () => {
			const item = createMockItem({
				metadata: {
					groundTruth: { file: "src/auth.py", startLine: 10, endLine: 20 },
				},
			});
			// Relevant chunk is at position 3, but topK=2
			const retrieved = [
				createMockResult("unrelated 1", { filepath: "src/other1.py", startLine: 1, endLine: 10 }),
				createMockResult("unrelated 2", { filepath: "src/other2.py", startLine: 1, endLine: 10 }),
				createMockResult("def auth_handler():", { filepath: "src/auth.py", startLine: 15, endLine: 25 }),
			];

			const result = await repoEvalPack.evaluate({ item, retrieved, run: { topK: 2 } });

			expect(result.score).toBe(0);
			expect(result.correct).toBe(false);
		});

		it("handles missing ground truth", async () => {
			const item = createMockItem({ metadata: {} });
			const retrieved = [createMockResult("some code", {})];

			const result = await repoEvalPack.evaluate({ item, retrieved, run: { topK: 10 } });

			expect(result.score).toBe(0);
			expect(result.correct).toBe(false);
			expect(result.answer).toBe("[no ground truth]");
		});

		it("uses default topK of 10 when not specified", async () => {
			const item = createMockItem({
				metadata: {
					groundTruth: { file: "src/auth.py", startLine: 10, endLine: 20 },
				},
			});
			// Relevant chunk at position 8 (0-indexed) - within default top-10
			const retrieved = Array(15)
				.fill(null)
				.map((_, i) =>
					i === 7
						? createMockResult("def auth_handler():", {
								filepath: "src/auth.py",
								startLine: 15,
								endLine: 25,
							})
						: createMockResult("unrelated", {
								filepath: `src/other${i}.py`,
								startLine: 1,
								endLine: 10,
							}),
				);

			// Don't specify topK - should use default of 10
			const result = await repoEvalPack.evaluate({ item, retrieved, run: {} });

			expect(result.score).toBe(1); // Should find relevant chunk at position 8
			expect(result.correct).toBe(true);
		});
	});
});

// ============================================================================
// RepoBench-R Pack Tests
// ============================================================================

describe("repoBenchRPack", () => {
	describe("isRelevant", () => {
		it("returns true when chunk content matches gold snippet with high Jaccard", () => {
			const goldCode = "def calculate_sum(a, b):\n    return a + b";
			const item = createMockItem({
				metadata: { goldSnippets: [goldCode] },
			});
			// Same code = Jaccard 1.0
			const result = createMockResult(goldCode, {});

			expect(repoBenchRPack.isRelevant({ item, result })).toBe(true);
		});

		it("returns false when Jaccard similarity is below threshold", () => {
			const item = createMockItem({
				metadata: { goldSnippets: ["def calculate_sum(a, b):\n    return a + b"] },
			});
			// Completely different code
			const result = createMockResult("class Database:\n    def connect(self):\n        pass", {});

			expect(repoBenchRPack.isRelevant({ item, result })).toBe(false);
		});

		it("matches any of multiple gold snippets", () => {
			const gold1 = "def foo(): pass";
			const gold2 = "def bar(): return 42";
			const item = createMockItem({
				metadata: { goldSnippets: [gold1, gold2] },
			});
			// Matches gold2
			const result = createMockResult("def bar(): return 42", {});

			expect(repoBenchRPack.isRelevant({ item, result })).toBe(true);
		});

		it("returns false when no gold snippets", () => {
			const item = createMockItem({ metadata: {} });
			const result = createMockResult("def foo(): pass", {});

			expect(repoBenchRPack.isRelevant({ item, result })).toBe(false);
		});
	});

	describe("evaluate", () => {
		it("returns score=1 when matching chunk found", async () => {
			const goldCode = "def calculate_sum(a, b):\n    return a + b";
			const item = createMockItem({
				metadata: { goldSnippets: [goldCode] },
			});
			const retrieved = [createMockResult(goldCode, {})];

			const result = await repoBenchRPack.evaluate({ item, retrieved, run: { topK: 10 } });

			expect(result.score).toBe(1);
			expect(result.correct).toBe(true);
			expect(result.reasoning).toContain("Jaccard threshold: 0.7");
		});

		it("returns score=0 when no match found", async () => {
			const item = createMockItem({
				metadata: { goldSnippets: ["def foo(): pass"] },
			});
			const retrieved = [createMockResult("completely different code", {})];

			const result = await repoBenchRPack.evaluate({ item, retrieved, run: { topK: 10 } });

			expect(result.score).toBe(0);
			expect(result.correct).toBe(false);
		});
	});
});

// ============================================================================
// CrossCodeEval Pack Tests
// ============================================================================

describe("crossCodeEvalPack", () => {
	describe("isRelevant", () => {
		it("returns true when chunk file is in dependency list", () => {
			const item = createMockItem({
				metadata: { dependencyFiles: ["src/utils/helper.py", "src/config.py"] },
			});
			const result = createMockResult("helper code", { filepath: "src/utils/helper.py" });

			expect(crossCodeEvalPack.isRelevant({ item, result })).toBe(true);
		});

		it("returns false when chunk file is not in dependency list", () => {
			const item = createMockItem({
				metadata: { dependencyFiles: ["src/utils/helper.py"] },
			});
			const result = createMockResult("other code", { filepath: "src/other.py" });

			expect(crossCodeEvalPack.isRelevant({ item, result })).toBe(false);
		});

		it("returns false when no filepath in metadata", () => {
			const item = createMockItem({
				metadata: { dependencyFiles: ["src/utils/helper.py"] },
			});
			const result = createMockResult("code without filepath", {});

			expect(crossCodeEvalPack.isRelevant({ item, result })).toBe(false);
		});
	});

	describe("evaluate", () => {
		it("returns full coverage when all dependency files retrieved", async () => {
			const item = createMockItem({
				metadata: { dependencyFiles: ["src/a.py", "src/b.py"] },
			});
			const retrieved = [
				createMockResult("code a", { filepath: "src/a.py" }),
				createMockResult("code b", { filepath: "src/b.py" }),
			];

			const result = await crossCodeEvalPack.evaluate({ item, retrieved, run: { topK: 10 } });

			expect(result.score).toBe(1);
			expect(result.correct).toBe(true);
			expect(result.reasoning).toContain("100.0%");
		});

		it("returns partial coverage", async () => {
			const item = createMockItem({
				metadata: { dependencyFiles: ["src/a.py", "src/b.py"] },
			});
			const retrieved = [createMockResult("code a", { filepath: "src/a.py" })];

			const result = await crossCodeEvalPack.evaluate({ item, retrieved, run: { topK: 10 } });

			expect(result.score).toBe(0.5);
			expect(result.correct).toBe(true);
			expect(result.reasoning).toContain("50.0%");
		});

		it("returns 0 when no dependencies covered", async () => {
			const item = createMockItem({
				metadata: { dependencyFiles: ["src/a.py", "src/b.py"] },
			});
			const retrieved = [createMockResult("unrelated", { filepath: "src/other.py" })];

			const result = await crossCodeEvalPack.evaluate({ item, retrieved, run: { topK: 10 } });

			expect(result.score).toBe(0);
			expect(result.correct).toBe(false);
		});

		it("returns no ground truth for empty dependency list", async () => {
			const item = createMockItem({
				metadata: { dependencyFiles: [] },
			});
			const retrieved = [createMockResult("code", { filepath: "src/a.py" })];

			// Empty array causes getGroundTruth to return null, triggering no-ground-truth path
			const result = await crossCodeEvalPack.evaluate({ item, retrieved, run: { topK: 10 } });

			expect(result.answer).toBe("[no ground truth]");
			expect(result.score).toBe(0);
		});
	});
});

// ============================================================================
// SWE-bench Lite Pack Tests
// ============================================================================

describe("sweBenchLitePack", () => {
	describe("isRelevant", () => {
		it("returns true when chunk file is in modified files list", () => {
			const item = createMockItem({
				metadata: { modifiedFiles: ["src/buggy.py", "src/tests.py"] },
			});
			const result = createMockResult("fixed code", { filepath: "src/buggy.py" });

			expect(sweBenchLitePack.isRelevant({ item, result })).toBe(true);
		});

		it("returns false when chunk file is not modified", () => {
			const item = createMockItem({
				metadata: { modifiedFiles: ["src/buggy.py"] },
			});
			const result = createMockResult("unmodified code", { filepath: "src/other.py" });

			expect(sweBenchLitePack.isRelevant({ item, result })).toBe(false);
		});
	});

	describe("evaluate", () => {
		it("returns full recall when all modified files retrieved", async () => {
			const item = createMockItem({
				metadata: { modifiedFiles: ["src/fix.py", "src/test.py"] },
			});
			const retrieved = [
				createMockResult("fix code", { filepath: "src/fix.py" }),
				createMockResult("test code", { filepath: "src/test.py" }),
			];

			const result = await sweBenchLitePack.evaluate({ item, retrieved, run: { topK: 10 } });

			expect(result.score).toBe(1);
			expect(result.correct).toBe(true);
			expect(result.reasoning).toContain("File recall");
			expect(result.reasoning).toContain("100.0%");
		});

		it("returns partial recall", async () => {
			const item = createMockItem({
				metadata: { modifiedFiles: ["src/fix.py", "src/test.py"] },
			});
			const retrieved = [createMockResult("fix code", { filepath: "src/fix.py" })];

			const result = await sweBenchLitePack.evaluate({ item, retrieved, run: { topK: 10 } });

			expect(result.score).toBe(0.5);
			expect(result.correct).toBe(true);
		});

		it("returns 0 when no modified files retrieved", async () => {
			const item = createMockItem({
				metadata: { modifiedFiles: ["src/fix.py"] },
			});
			const retrieved = [createMockResult("unrelated", { filepath: "src/other.py" })];

			const result = await sweBenchLitePack.evaluate({ item, retrieved, run: { topK: 10 } });

			expect(result.score).toBe(0);
			expect(result.correct).toBe(false);
		});

		it("deduplicates retrieved files", async () => {
			const item = createMockItem({
				metadata: { modifiedFiles: ["src/fix.py"] },
			});
			// Multiple chunks from same file
			const retrieved = [
				createMockResult("chunk 1", { filepath: "src/fix.py" }),
				createMockResult("chunk 2", { filepath: "src/fix.py" }),
				createMockResult("chunk 3", { filepath: "src/fix.py" }),
			];

			const result = await sweBenchLitePack.evaluate({ item, retrieved, run: { topK: 10 } });

			expect(result.score).toBe(1);
			expect(result.reasoning).toContain("Retrieved files (unique): 1");
		});
	});
});

// ============================================================================
// Pre-built Packs (backward compatibility)
// ============================================================================

describe("pre-built packs", () => {
	it("exports repoEvalPack", () => {
		expect(repoEvalPack).toBeDefined();
		expect(repoEvalPack.benchmarkName).toBe("repoeval");
	});

	it("exports repoBenchRPack", () => {
		expect(repoBenchRPack).toBeDefined();
		expect(repoBenchRPack.benchmarkName).toBe("repobench-r");
	});

	it("exports crossCodeEvalPack", () => {
		expect(crossCodeEvalPack).toBeDefined();
		expect(crossCodeEvalPack.benchmarkName).toBe("crosscodeeval");
	});

	it("exports sweBenchLitePack", () => {
		expect(sweBenchLitePack).toBeDefined();
		expect(sweBenchLitePack.benchmarkName).toBe("swebench-lite");
	});
});
