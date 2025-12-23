/**
 * LlamaIndex CodeSplitter Python Bridge
 *
 * TypeScript wrapper for calling LlamaIndex CodeSplitter via subprocess.
 * Uses tree-sitter parsing for semantic code chunking.
 *
 * Requirements:
 *   - Python 3.10+
 *   - LlamaIndex package: pip install llama-index-core
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callPythonBridge, isPythonPackageAvailable } from "./python-bridge-utils.ts";

// Resolve path to the Python script
const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, "llamaindex_bridge.py");

/**
 * Chunk result from LlamaIndex.
 */
export interface LlamaIndexChunkResult {
	id: string;
	text: string;
	startLine: number;
	endLine: number;
}

/**
 * Options for LlamaIndex chunking.
 */
export interface LlamaIndexOptions {
	/** Maximum chunk size in characters */
	chunkSize: number;
	/** Python executable path (default: "python3") */
	pythonPath?: string;
}

/**
 * Call LlamaIndex CodeSplitter via subprocess.
 *
 * @param filepath - File path (used for language detection)
 * @param code - Source code content
 * @param options - Chunking options
 * @returns Array of chunk results
 */
export async function callLlamaIndex(
	filepath: string,
	code: string,
	options: LlamaIndexOptions,
): Promise<LlamaIndexChunkResult[]> {
	const pythonPath =
		options.pythonPath || process.env.LLAMAINDEX_PYTHON_PATH || "python3";
	const args = [SCRIPT_PATH, filepath, String(options.chunkSize)];

	try {
		return await callPythonBridge<LlamaIndexChunkResult[]>(
			SCRIPT_PATH,
			args,
			code,
			pythonPath,
			"LlamaIndex",
		);
	} catch (error) {
		throw new Error(
			`${error}\nMake sure Python is installed and LlamaIndex is available:\n` +
				`  pip install llama-index-core`,
		);
	}
}

/**
 * Check if LlamaIndex is available.
 */
export async function isLlamaIndexAvailable(
	pythonPath = "python3",
): Promise<boolean> {
	return isPythonPackageAvailable(
		pythonPath,
		"from llama_index.core.node_parser import CodeSplitter",
	);
}
