/**
 * Chonkie Python Bridge
 *
 * TypeScript wrapper for calling Chonkie Python chunkers via subprocess.
 * Supports both CodeChunker (semantic) and RecursiveChunker (character fallback).
 *
 * Requirements:
 *   - Python 3.10+
 *   - Chonkie package: pip install chonkie tree-sitter-language-pack
 *   - Or use uv: uv pip install chonkie tree-sitter-language-pack
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callPythonBridge, isPythonPackageAvailable } from "./python-bridge-utils.ts";

// Resolve path to the Python script
const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, "chonkie_bridge.py");

/**
 * Chunk result from Chonkie.
 */
export interface ChonkieChunkResult {
	id: string;
	text: string;
	startLine: number;
	endLine: number;
}

/**
 * Chunker type supported by the bridge.
 * 
 * NOTE: Only "code" and "recursive" are used for code benchmarking.
 * semantic/token/sentence are for natural language, not source code.
 */
export type ChonkieChunkerType = "code" | "recursive";

/**
 * Options for Chonkie chunking.
 */
export interface ChonkieOptions {
	/** Chunker type: "code" (semantic) or "recursive" (character fallback) */
	chunkerType: ChonkieChunkerType;
	/** Maximum chunk size in characters */
	chunkSize: number;
	/** Overlap in characters (only for recursive chunker) */
	overlap?: number;
	/** Python executable path (default: "python3") */
	pythonPath?: string;
}

/**
 * Call Chonkie Python chunker via subprocess.
 *
 * @param filepath - File path (used for language detection)
 * @param code - Source code content
 * @param options - Chunking options
 * @returns Array of chunk results
 */
export async function callChonkie(
	filepath: string,
	code: string,
	options: ChonkieOptions,
): Promise<ChonkieChunkResult[]> {
	const pythonPath = options.pythonPath || process.env.CHONKIE_PYTHON_PATH || "python3";
	const args = [
		SCRIPT_PATH,
		options.chunkerType,
		filepath,
		String(options.chunkSize),
	];

	if (options.overlap !== undefined) {
		args.push(String(options.overlap));
	}

	try {
		return await callPythonBridge<ChonkieChunkResult[]>(
			SCRIPT_PATH,
			args,
			code,
			pythonPath,
			"Chonkie",
		);
	} catch (error) {
		// Add installation instructions to error message
		throw new Error(
			`${error}\nMake sure Python is installed and Chonkie is available:\n` +
				`  pip install chonkie tree-sitter-language-pack`,
		);
	}
}

/**
 * Check if Chonkie is available.
 */
export async function isChonkieAvailable(
	pythonPath = "python3",
): Promise<boolean> {
	return isPythonPackageAvailable(pythonPath, "import chonkie");
}
