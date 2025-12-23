/**
 * LangChain RecursiveCharacterTextSplitter Python Bridge
 *
 * TypeScript wrapper for calling LangChain text splitter via subprocess.
 * Uses language-aware separators for code chunking.
 *
 * Requirements:
 *   - Python 3.10+
 *   - LangChain package: pip install langchain-text-splitters
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callPythonBridge, isPythonPackageAvailable } from "./python-bridge-utils.ts";

// Resolve path to the Python script
const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, "langchain_bridge.py");

/**
 * Chunk result from LangChain.
 */
export interface LangChainChunkResult {
	id: string;
	text: string;
	startLine: number;
	endLine: number;
}

/**
 * Options for LangChain chunking.
 */
export interface LangChainOptions {
	/** Maximum chunk size in characters */
	chunkSize: number;
	/** Overlap in characters (default: 100) */
	overlap?: number;
	/** Python executable path (default: "python3") */
	pythonPath?: string;
}

/**
 * Call LangChain RecursiveCharacterTextSplitter via subprocess.
 *
 * @param filepath - File path (used for language detection)
 * @param code - Source code content
 * @param options - Chunking options
 * @returns Array of chunk results
 */
export async function callLangChain(
	filepath: string,
	code: string,
	options: LangChainOptions,
): Promise<LangChainChunkResult[]> {
	const pythonPath =
		options.pythonPath || process.env.LANGCHAIN_PYTHON_PATH || "python3";
	const args = [
		SCRIPT_PATH,
		filepath,
		String(options.chunkSize),
		String(options.overlap ?? 100),
	];

	try {
		return await callPythonBridge<LangChainChunkResult[]>(
			SCRIPT_PATH,
			args,
			code,
			pythonPath,
			"LangChain",
		);
	} catch (error) {
		throw new Error(
			`${error}\nMake sure Python is installed and LangChain is available:\n` +
				`  pip install langchain-text-splitters`,
		);
	}
}

/**
 * Check if LangChain text splitters are available.
 */
export async function isLangChainAvailable(
	pythonPath = "python3",
): Promise<boolean> {
	return isPythonPackageAvailable(
		pythonPath,
		"from langchain_text_splitters import RecursiveCharacterTextSplitter",
	);
}
