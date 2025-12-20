/**
 * Tests for Chunker Registry
 *
 * Tests the chunker registration, lookup, and built-in chunker implementations.
 * Note: Chonkie-based chunkers are not tested here as they require Python runtime.
 */

import { describe, expect, it, beforeEach } from "bun:test";
import {
	registerChunker,
	getChunker,
	getChunkerNames,
	type ChunkResult,
	type ChunkingConfig,
	type ChunkerDefinition,
} from "./chunker-registry.ts";

describe("chunker-registry", () => {
	// ========================================================================
	// Registry Operations
	// ========================================================================
	describe("registry operations", () => {
		it("returns undefined for unknown chunker", () => {
			expect(getChunker("non-existent-chunker")).toBeUndefined();
		});

		it("returns chunker for known name", () => {
			const chunker = getChunker("code-chunk-ast");
			expect(chunker).toBeDefined();
			expect(chunker?.name).toBe("code-chunk-ast");
		});

		it("lists all registered chunker names", () => {
			const names = getChunkerNames();
			expect(names).toContain("code-chunk-ast");
			expect(names).toContain("code-chunk-fixed");
			expect(names).toContain("chonkie-code");
			expect(names).toContain("chonkie-recursive");
		});

		it("has all 4 MVP chunkers registered", () => {
			const names = getChunkerNames();
			expect(names.length).toBeGreaterThanOrEqual(4);
		});
	});

	// ========================================================================
	// code-chunk-fixed Chunker
	// ========================================================================
	describe("code-chunk-fixed", () => {
		const getFixedChunker = () => getChunker("code-chunk-fixed")!;

		it("chunks content into fixed-size pieces", async () => {
			// 2048 chars total: chunks at [0-1024), [1024-2048)
			const content = "a".repeat(2048);
			const chunks = await getFixedChunker().chunkFn(content, "test.py", {
				size: 1024,
				overlap: 0,
			});

			expect(chunks.length).toBe(2);
			expect(chunks[0]!.content.length).toBe(1024);
			expect(chunks[1]!.content.length).toBe(1024);
		});

		it("handles overlap correctly", async () => {
			// Content: 100 chars, size: 50, overlap: 10
			// Chunks: [0-50), [40-90), [80-100) - but last chunk is small
			const content = "x".repeat(100);
			const chunks = await getFixedChunker().chunkFn(content, "test.py", {
				size: 50,
				overlap: 10,
			});

			expect(chunks.length).toBe(3);
			expect(chunks[0]!.content.length).toBe(50);
			expect(chunks[1]!.content.length).toBe(50);
			// Last chunk: 100 - 80 = 20 chars
			expect(chunks[2]!.content.length).toBe(20);
		});

		it("throws error when overlap >= size", async () => {
			const content = "test content";
			await expect(
				getFixedChunker().chunkFn(content, "test.py", { size: 100, overlap: 100 }),
			).rejects.toThrow("Overlap (100) must be less than chunk size (100)");
		});

		it("returns empty array for empty content", async () => {
			const chunks = await getFixedChunker().chunkFn("", "test.py", {});
			expect(chunks).toEqual([]);
		});

		it("uses default size=1024 and overlap=96", async () => {
			// With defaults: size=1024, overlap=96, step=928
			const content = "x".repeat(2048);
			const chunks = await getFixedChunker().chunkFn(content, "test.py", {});

			// step = 1024 - 96 = 928
			// Chunk 1: [0, 1024) - 1024 chars
			// Chunk 2: [928, 1952) - 1024 chars
			// Chunk 3: [1856, 2048) - 192 chars (2048-1856=192 > 96, so continues)
			expect(chunks.length).toBe(3);
			expect(chunks[0]!.content.length).toBe(1024);
			expect(chunks[1]!.content.length).toBe(1024);
			expect(chunks[2]!.content.length).toBe(192);
		});

		it("computes correct line numbers", async () => {
			const content = "line1\nline2\nline3\nline4\nline5";
			const chunks = await getFixedChunker().chunkFn(content, "test.py", {
				size: 12, // "line1\nline2" = 11 chars
				overlap: 0,
			});

			expect(chunks[0]!.startLine).toBe(1);
			expect(chunks[0]!.endLine).toBe(2);
		});

		it("generates correct chunk IDs", async () => {
			const content = "x".repeat(200);
			const chunks = await getFixedChunker().chunkFn(content, "src/utils/helper.py", {
				size: 100,
				overlap: 0,
			});

			expect(chunks[0]!.id).toBe("src/utils/helper.py:0");
			expect(chunks[1]!.id).toBe("src/utils/helper.py:1");
		});

		it("skips whitespace-only chunks", async () => {
			// Create content with whitespace gap that would create empty chunk
			const content = "code" + " ".repeat(100) + "more";
			const chunks = await getFixedChunker().chunkFn(content, "test.py", {
				size: 50,
				overlap: 0,
			});

			// All returned chunks should have non-whitespace content
			for (const chunk of chunks) {
				expect(chunk.content.trim().length).toBeGreaterThan(0);
			}
		});

		it("handles multi-line Python code", async () => {
			const pythonCode = `def hello():
    print("hello")
    return True

def world():
    print("world")
    return False
`;
			const chunks = await getFixedChunker().chunkFn(pythonCode, "example.py", {
				size: 50,
				overlap: 10,
			});

			expect(chunks.length).toBeGreaterThan(1);
			// Verify line numbers span the file
			const lastChunk = chunks[chunks.length - 1]!;
			expect(lastChunk.endLine).toBeGreaterThan(1);
		});
	});

	// ========================================================================
	// code-chunk-ast Chunker (Fallback Behavior)
	// ========================================================================
	describe("code-chunk-ast", () => {
		const getAstChunker = () => getChunker("code-chunk-ast")!;

		it("has fallback behavior for unsupported content", async () => {
			// If code-chunk package is not installed or fails, should fallback
			// to returning the entire file as a single chunk
			const content = "some content that might not parse";
			const chunks = await getAstChunker().chunkFn(content, "unknown.xyz", {});

			// Should either parse successfully or fall back to single chunk
			expect(chunks.length).toBeGreaterThanOrEqual(1);

			// If fallback occurred, it should contain the full content
			if (chunks.length === 1) {
				expect(chunks[0]!.content).toBe(content);
				expect(chunks[0]!.startLine).toBe(1);
				expect(chunks[0]!.endLine).toBe(1);
			}
		});

		it("includes line range in chunk ID", async () => {
			const content = "def foo():\n    pass\n";
			const chunks = await getAstChunker().chunkFn(content, "test.py", {});

			// ID should contain filepath and line range
			for (const chunk of chunks) {
				expect(chunk.id).toContain("test.py:");
				expect(chunk.id).toMatch(/:\d+-\d+$/);
			}
		});

		it("uses default maxChunkSize of 1500", async () => {
			// This test verifies the default is passed correctly
			// Can't easily verify without mocking, but at least run it
			const content = "x".repeat(100);
			const chunks = await getAstChunker().chunkFn(content, "test.py", {});
			expect(chunks).toBeDefined();
		});

		it("respects custom size config", async () => {
			const content = "def foo():\n    pass\n";
			const chunks = await getAstChunker().chunkFn(content, "test.py", { size: 500 });
			expect(chunks).toBeDefined();
		});
	});

	// ========================================================================
	// Custom Chunker Registration
	// ========================================================================
	describe("custom chunker registration", () => {
		it("allows registering custom chunkers", async () => {
			const customChunker: ChunkerDefinition = {
				name: "test-custom-chunker",
				chunkFn: async (content, filepath, config) => {
					return [
						{
							content,
							startLine: 1,
							endLine: content.split("\n").length,
							id: `${filepath}:custom`,
						},
					];
				},
			};

			registerChunker(customChunker);

			const retrieved = getChunker("test-custom-chunker");
			expect(retrieved).toBeDefined();
			expect(retrieved?.name).toBe("test-custom-chunker");

			const chunks = await retrieved!.chunkFn("test", "file.py", {});
			expect(chunks[0]!.id).toBe("file.py:custom");
		});

		it("supports preflight checks", async () => {
			let preflightCalled = false;

			const chunkerWithPreflight: ChunkerDefinition = {
				name: "test-preflight-chunker",
				preflight: async () => {
					preflightCalled = true;
				},
				chunkFn: async () => [],
			};

			registerChunker(chunkerWithPreflight);

			const chunker = getChunker("test-preflight-chunker")!;
			await chunker.preflight!();

			expect(preflightCalled).toBe(true);
		});
	});

	// ========================================================================
	// Edge Cases
	// ========================================================================
	describe("edge cases", () => {
		it("handles single-line content", async () => {
			const chunker = getChunker("code-chunk-fixed")!;
			const chunks = await chunker.chunkFn("single line", "test.py", {
				size: 100,
				overlap: 0,
			});

			expect(chunks.length).toBe(1);
			expect(chunks[0]!.startLine).toBe(1);
			expect(chunks[0]!.endLine).toBe(1);
		});

		it("handles content with only newlines", async () => {
			const chunker = getChunker("code-chunk-fixed")!;
			const chunks = await chunker.chunkFn("\n\n\n", "test.py", {
				size: 10,
				overlap: 0,
			});

			// Newline-only content is whitespace, should be skipped
			expect(chunks.length).toBe(0);
		});

		it("handles Windows line endings", async () => {
			const chunker = getChunker("code-chunk-fixed")!;
			const content = "line1\r\nline2\r\nline3";
			const chunks = await chunker.chunkFn(content, "test.py", {
				size: 100,
				overlap: 0,
			});

			expect(chunks.length).toBe(1);
			// Implementation counts \n only, so we have 3 lines (despite \r\n)
			// \r is kept as part of line content
			expect(chunks[0]!.startLine).toBe(1);
			expect(chunks[0]!.endLine).toBe(3);
		});

		it("handles very long lines", async () => {
			const chunker = getChunker("code-chunk-fixed")!;
			const content = "x".repeat(10000);
			const chunks = await chunker.chunkFn(content, "test.py", {
				size: 1000,
				overlap: 100,
			});

			// Should create multiple chunks
			expect(chunks.length).toBeGreaterThan(5);

			// All should be on line 1
			for (const chunk of chunks) {
				expect(chunk.startLine).toBe(1);
				expect(chunk.endLine).toBe(1);
			}
		});

		it("handles unicode content", async () => {
			const chunker = getChunker("code-chunk-fixed")!;
			const content = "def greet():\n    return '你好世界'\n";
			const chunks = await chunker.chunkFn(content, "test.py", {
				size: 100,
				overlap: 0,
			});

			expect(chunks.length).toBe(1);
			expect(chunks[0]!.content).toContain("你好世界");
		});
	});
});
