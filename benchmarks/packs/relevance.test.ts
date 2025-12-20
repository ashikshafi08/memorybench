/**
 * Tests for Ground-Truth Matchers
 *
 * Tests the relevance primitives used by code retrieval benchmarks:
 * - RepoEval: lineRangeOverlaps, lineRangeIoU, isLocationRelevant
 * - RepoBench-R: jaccardSimilarity, isJaccardMatch
 * - SWE-bench: fileMatches, isSWEBenchRelevant
 * - CrossCodeEval: crossFileCoverage, isCrossCodeRelevant
 */

import { describe, expect, it } from "bun:test";
import {
	lineRangeOverlaps,
	lineRangeIoU,
	isLocationRelevant,
	jaccardSimilarity,
	isJaccardMatch,
	fileMatches,
	isSWEBenchRelevant,
	crossFileCoverage,
	isCrossCodeRelevant,
	type LineSpan,
	type ChunkLocation,
} from "./relevance.ts";

describe("relevance matchers", () => {
	// ========================================================================
	// Line Range Overlap (RepoEval)
	// ========================================================================
	describe("lineRangeOverlaps", () => {
		it("returns true for fully overlapping ranges", () => {
			const chunk: LineSpan = { startLine: 10, endLine: 20 };
			const target: LineSpan = { startLine: 12, endLine: 18 };
			expect(lineRangeOverlaps(chunk, target)).toBe(true);
		});

		it("returns true for partial overlap at start", () => {
			const chunk: LineSpan = { startLine: 5, endLine: 15 };
			const target: LineSpan = { startLine: 10, endLine: 20 };
			expect(lineRangeOverlaps(chunk, target)).toBe(true);
		});

		it("returns true for partial overlap at end", () => {
			const chunk: LineSpan = { startLine: 15, endLine: 25 };
			const target: LineSpan = { startLine: 10, endLine: 20 };
			expect(lineRangeOverlaps(chunk, target)).toBe(true);
		});

		it("returns true for edge-touching ranges (single line overlap)", () => {
			const chunk: LineSpan = { startLine: 10, endLine: 15 };
			const target: LineSpan = { startLine: 15, endLine: 20 };
			expect(lineRangeOverlaps(chunk, target)).toBe(true);
		});

		it("returns true for identical ranges", () => {
			const chunk: LineSpan = { startLine: 10, endLine: 20 };
			const target: LineSpan = { startLine: 10, endLine: 20 };
			expect(lineRangeOverlaps(chunk, target)).toBe(true);
		});

		it("returns false for non-overlapping ranges", () => {
			const chunk: LineSpan = { startLine: 1, endLine: 10 };
			const target: LineSpan = { startLine: 15, endLine: 25 };
			expect(lineRangeOverlaps(chunk, target)).toBe(false);
		});

		it("returns false for adjacent but non-overlapping ranges", () => {
			const chunk: LineSpan = { startLine: 1, endLine: 10 };
			const target: LineSpan = { startLine: 11, endLine: 20 };
			expect(lineRangeOverlaps(chunk, target)).toBe(false);
		});

		it("handles single-line chunks", () => {
			const chunk: LineSpan = { startLine: 15, endLine: 15 };
			const target: LineSpan = { startLine: 10, endLine: 20 };
			expect(lineRangeOverlaps(chunk, target)).toBe(true);
		});

		it("handles single-line targets", () => {
			const chunk: LineSpan = { startLine: 10, endLine: 20 };
			const target: LineSpan = { startLine: 15, endLine: 15 };
			expect(lineRangeOverlaps(chunk, target)).toBe(true);
		});

		it("handles inverted line ranges (startLine > endLine)", () => {
			// Inverted ranges are technically malformed input
			// The function returns false for inverted ranges (no overlap with valid ranges)
			const chunk: LineSpan = { startLine: 20, endLine: 10 }; // inverted
			const target: LineSpan = { startLine: 15, endLine: 18 };
			// chunk.endLine (10) >= target.startLine (15) is false, so no overlap
			expect(lineRangeOverlaps(chunk, target)).toBe(false);
		});
	});

	describe("lineRangeIoU", () => {
		it("returns 1.0 for identical ranges", () => {
			const chunk: LineSpan = { startLine: 10, endLine: 20 };
			const target: LineSpan = { startLine: 10, endLine: 20 };
			expect(lineRangeIoU(chunk, target)).toBe(1.0);
		});

		it("returns 0 for non-overlapping ranges", () => {
			const chunk: LineSpan = { startLine: 1, endLine: 10 };
			const target: LineSpan = { startLine: 15, endLine: 25 };
			expect(lineRangeIoU(chunk, target)).toBe(0);
		});

		it("computes correct IoU for partial overlap", () => {
			// Chunk: lines 10-20 (11 lines)
			// Target: lines 15-25 (11 lines)
			// Intersection: lines 15-20 (6 lines)
			// Union: 11 + 11 - 6 = 16 lines
			// IoU: 6/16 = 0.375
			const chunk: LineSpan = { startLine: 10, endLine: 20 };
			const target: LineSpan = { startLine: 15, endLine: 25 };
			expect(lineRangeIoU(chunk, target)).toBeCloseTo(0.375, 3);
		});

		it("computes correct IoU when target is subset of chunk", () => {
			// Chunk: lines 5-25 (21 lines)
			// Target: lines 10-20 (11 lines)
			// Intersection: 11 lines
			// Union: 21 lines
			// IoU: 11/21 ≈ 0.524
			const chunk: LineSpan = { startLine: 5, endLine: 25 };
			const target: LineSpan = { startLine: 10, endLine: 20 };
			expect(lineRangeIoU(chunk, target)).toBeCloseTo(11 / 21, 3);
		});

		it("handles single-line overlap", () => {
			// Chunk: lines 10-15 (6 lines)
			// Target: lines 15-20 (6 lines)
			// Intersection: 1 line (line 15)
			// Union: 6 + 6 - 1 = 11 lines
			// IoU: 1/11 ≈ 0.091
			const chunk: LineSpan = { startLine: 10, endLine: 15 };
			const target: LineSpan = { startLine: 15, endLine: 20 };
			expect(lineRangeIoU(chunk, target)).toBeCloseTo(1 / 11, 3);
		});
	});

	describe("isLocationRelevant", () => {
		it("returns true when file matches and lines overlap", () => {
			const chunk: ChunkLocation = {
				filepath: "src/utils/helper.py",
				startLine: 10,
				endLine: 20,
			};
			expect(isLocationRelevant(chunk, "src/utils/helper.py", { startLine: 15, endLine: 25 })).toBe(true);
		});

		it("returns false when file does not match", () => {
			const chunk: ChunkLocation = {
				filepath: "src/utils/helper.py",
				startLine: 10,
				endLine: 20,
			};
			expect(isLocationRelevant(chunk, "src/utils/other.py", { startLine: 10, endLine: 20 })).toBe(false);
		});

		it("returns false when file matches but lines do not overlap", () => {
			const chunk: ChunkLocation = {
				filepath: "src/utils/helper.py",
				startLine: 1,
				endLine: 10,
			};
			expect(isLocationRelevant(chunk, "src/utils/helper.py", { startLine: 50, endLine: 60 })).toBe(false);
		});

		it("returns true for file match when no line span provided", () => {
			const chunk: ChunkLocation = {
				filepath: "src/utils/helper.py",
				startLine: 1,
				endLine: 10,
			};
			expect(isLocationRelevant(chunk, "src/utils/helper.py")).toBe(true);
		});

		it("returns true when chunk has no line info but file matches", () => {
			const chunk: ChunkLocation = { filepath: "src/utils/helper.py" };
			expect(isLocationRelevant(chunk, "src/utils/helper.py", { startLine: 10, endLine: 20 })).toBe(true);
		});

		it("handles suffix matching for repo-relative paths", () => {
			const chunk: ChunkLocation = {
				filepath: "/full/path/to/repo/src/utils/helper.py",
				startLine: 10,
				endLine: 20,
			};
			expect(isLocationRelevant(chunk, "src/utils/helper.py", { startLine: 10, endLine: 20 })).toBe(true);
		});

		it("handles Windows-style paths", () => {
			const chunk: ChunkLocation = {
				filepath: "src\\utils\\helper.py",
				startLine: 10,
				endLine: 20,
			};
			expect(isLocationRelevant(chunk, "src/utils/helper.py", { startLine: 10, endLine: 20 })).toBe(true);
		});

		it("is case-insensitive for file paths", () => {
			const chunk: ChunkLocation = {
				filepath: "SRC/Utils/Helper.py",
				startLine: 10,
				endLine: 20,
			};
			expect(isLocationRelevant(chunk, "src/utils/helper.py", { startLine: 10, endLine: 20 })).toBe(true);
		});

		it("does not match partial filenames without path separator", () => {
			// oauth.py should NOT match auth.py (suffix without separator)
			const chunk: ChunkLocation = {
				filepath: "oauth.py",
				startLine: 10,
				endLine: 20,
			};
			expect(isLocationRelevant(chunk, "auth.py", { startLine: 10, endLine: 20 })).toBe(false);
		});

		it("matches suffix only after path separator", () => {
			// /path/to/auth.py should match auth.py (suffix after separator)
			const chunk: ChunkLocation = {
				filepath: "/full/path/to/auth.py",
				startLine: 10,
				endLine: 20,
			};
			expect(isLocationRelevant(chunk, "auth.py", { startLine: 10, endLine: 20 })).toBe(true);
		});
	});

	// ========================================================================
	// Jaccard Similarity (RepoBench-R)
	// ========================================================================
	describe("jaccardSimilarity", () => {
		it("returns 1.0 for identical strings", () => {
			const text = "def hello_world(): print('hello')";
			expect(jaccardSimilarity(text, text)).toBe(1.0);
		});

		it("returns 1.0 for both empty strings", () => {
			expect(jaccardSimilarity("", "")).toBe(1.0);
		});

		it("returns 0 for one empty string", () => {
			expect(jaccardSimilarity("hello world", "")).toBe(0);
			expect(jaccardSimilarity("", "hello world")).toBe(0);
		});

		it("returns 0 for completely different strings", () => {
			expect(jaccardSimilarity("abc def ghi", "xyz uvw rst")).toBe(0);
		});

		it("computes correct similarity for partial overlap", () => {
			// Tokens A: {hello, world, foo} (3 tokens)
			// Tokens B: {hello, world, bar} (3 tokens)
			// Intersection: 2 (hello, world)
			// Union: 4 (hello, world, foo, bar)
			// Jaccard: 2/4 = 0.5
			expect(jaccardSimilarity("hello world foo", "hello world bar")).toBe(0.5);
		});

		it("handles punctuation and special characters", () => {
			// Both normalize to: {def, foo, return, x, 1}
			const a = "def foo(): return x + 1";
			const b = "def foo(): return x + 1";
			expect(jaccardSimilarity(a, b)).toBe(1.0);
		});

		it("is case-insensitive", () => {
			expect(jaccardSimilarity("Hello World", "hello world")).toBe(1.0);
		});

		it("handles whitespace variations", () => {
			expect(jaccardSimilarity("hello   world", "hello world")).toBe(1.0);
		});
	});

	describe("isJaccardMatch", () => {
		it("returns true when similarity meets threshold", () => {
			// 0.5 similarity >= 0.5 threshold
			expect(isJaccardMatch("hello world foo", "hello world bar", 0.5)).toBe(true);
		});

		it("returns false when similarity is below threshold", () => {
			// 0.5 similarity < 0.7 threshold
			expect(isJaccardMatch("hello world foo", "hello world bar", 0.7)).toBe(false);
		});

		it("uses default threshold of 0.7", () => {
			// High similarity (should pass 0.7)
			expect(isJaccardMatch("def foo(): return 1", "def foo(): return 1")).toBe(true);

			// Low similarity (should fail 0.7)
			expect(isJaccardMatch("abc", "xyz")).toBe(false);
		});

		it("handles code snippets with high similarity", () => {
			const chunk = `def calculate_sum(a, b):
    return a + b`;
			const gold = `def calculate_sum(a, b):
    return a + b`;
			expect(isJaccardMatch(chunk, gold)).toBe(true);
		});

		it("handles code snippets with low similarity", () => {
			const chunk = `def calculate_sum(a, b):
    return a + b`;
			const gold = `class Database:
    def connect(self):
        pass`;
			expect(isJaccardMatch(chunk, gold)).toBe(false);
		});
	});

	// ========================================================================
	// File Match (SWE-bench Lite)
	// ========================================================================
	describe("fileMatches", () => {
		it("returns true when file is in modified list", () => {
			expect(fileMatches("src/utils/helper.py", ["src/utils/helper.py", "src/main.py"])).toBe(true);
		});

		it("returns false when file is not in modified list", () => {
			expect(fileMatches("src/other.py", ["src/utils/helper.py", "src/main.py"])).toBe(false);
		});

		it("returns false for empty modified list", () => {
			expect(fileMatches("src/utils/helper.py", [])).toBe(false);
		});

		it("handles suffix matching", () => {
			expect(
				fileMatches("/full/path/to/repo/src/utils/helper.py", ["src/utils/helper.py"]),
			).toBe(true);
		});

		it("handles Windows paths", () => {
			expect(fileMatches("src\\utils\\helper.py", ["src/utils/helper.py"])).toBe(true);
		});

		it("is case-insensitive", () => {
			expect(fileMatches("SRC/Utils/Helper.py", ["src/utils/helper.py"])).toBe(true);
		});
	});

	describe("isSWEBenchRelevant", () => {
		it("returns true when file matches (no line ranges)", () => {
			const chunk: ChunkLocation = { filepath: "src/utils/helper.py", startLine: 10, endLine: 20 };
			expect(isSWEBenchRelevant(chunk, ["src/utils/helper.py"])).toBe(true);
		});

		it("returns false when file does not match", () => {
			const chunk: ChunkLocation = { filepath: "src/other.py", startLine: 10, endLine: 20 };
			expect(isSWEBenchRelevant(chunk, ["src/utils/helper.py"])).toBe(false);
		});

		it("returns true when file matches and lines overlap with modified range", () => {
			const chunk: ChunkLocation = { filepath: "src/utils/helper.py", startLine: 10, endLine: 20 };
			const lineRanges = new Map([["src/utils/helper.py", [{ startLine: 15, endLine: 25 }]]]);
			expect(isSWEBenchRelevant(chunk, ["src/utils/helper.py"], lineRanges)).toBe(true);
		});

		it("returns true when file matches but no line info in chunk", () => {
			const chunk: ChunkLocation = { filepath: "src/utils/helper.py" };
			const lineRanges = new Map([["src/utils/helper.py", [{ startLine: 15, endLine: 25 }]]]);
			expect(isSWEBenchRelevant(chunk, ["src/utils/helper.py"], lineRanges)).toBe(true);
		});

		it("returns true when chunk overlaps any of multiple modified ranges", () => {
			const chunk: ChunkLocation = { filepath: "src/utils/helper.py", startLine: 50, endLine: 60 };
			const lineRanges = new Map([
				[
					"src/utils/helper.py",
					[
						{ startLine: 10, endLine: 20 },
						{ startLine: 55, endLine: 65 }, // overlaps
					],
				],
			]);
			expect(isSWEBenchRelevant(chunk, ["src/utils/helper.py"], lineRanges)).toBe(true);
		});
	});

	// ========================================================================
	// Cross-File Coverage (CrossCodeEval)
	// ========================================================================
	describe("crossFileCoverage", () => {
		it("returns 1.0 when all ground truth files are retrieved", () => {
			const retrieved = ["src/a.py", "src/b.py", "src/c.py"];
			const groundTruth = ["src/a.py", "src/b.py"];
			expect(crossFileCoverage(retrieved, groundTruth)).toBe(1.0);
		});

		it("returns 0 when no ground truth files are retrieved", () => {
			const retrieved = ["src/x.py", "src/y.py"];
			const groundTruth = ["src/a.py", "src/b.py"];
			expect(crossFileCoverage(retrieved, groundTruth)).toBe(0);
		});

		it("returns 1.0 for empty ground truth (no dependencies)", () => {
			const retrieved = ["src/a.py"];
			expect(crossFileCoverage(retrieved, [])).toBe(1.0);
		});

		it("computes correct partial coverage", () => {
			// 1 of 2 covered = 0.5
			const retrieved = ["src/a.py"];
			const groundTruth = ["src/a.py", "src/b.py"];
			expect(crossFileCoverage(retrieved, groundTruth)).toBe(0.5);
		});

		it("handles suffix matching for coverage", () => {
			const retrieved = ["/full/path/src/a.py"];
			const groundTruth = ["src/a.py"];
			expect(crossFileCoverage(retrieved, groundTruth)).toBe(1.0);
		});

		it("handles duplicate files in retrieved", () => {
			const retrieved = ["src/a.py", "src/a.py", "src/b.py"];
			const groundTruth = ["src/a.py", "src/b.py"];
			expect(crossFileCoverage(retrieved, groundTruth)).toBe(1.0);
		});
	});

	describe("isCrossCodeRelevant", () => {
		it("returns true when chunk file is in dependency list", () => {
			expect(isCrossCodeRelevant("src/utils/helper.py", ["src/utils/helper.py", "src/main.py"])).toBe(
				true,
			);
		});

		it("returns false when chunk file is not in dependency list", () => {
			expect(isCrossCodeRelevant("src/other.py", ["src/utils/helper.py", "src/main.py"])).toBe(false);
		});

		it("handles suffix matching", () => {
			expect(
				isCrossCodeRelevant("/full/path/src/utils/helper.py", ["src/utils/helper.py"]),
			).toBe(true);
		});
	});
});
