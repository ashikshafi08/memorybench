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

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

	return new Promise((resolve, reject) => {
		const proc = spawn(pythonPath, args, {
			stdio: ["pipe", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		proc.stdout.on("data", (data: Buffer) => {
			stdout += data.toString();
		});

		proc.stderr.on("data", (data: Buffer) => {
			stderr += data.toString();
		});

		proc.on("close", (exitCode: number | null) => {
			if (exitCode !== 0) {
				reject(
					new Error(
						`LangChain bridge failed with exit code ${exitCode}: ${stderr || stdout}`,
					),
				);
				return;
			}

			try {
				const result = JSON.parse(stdout);
				if (result.error) {
					reject(new Error(`LangChain error: ${result.error}`));
					return;
				}
				resolve(result as LangChainChunkResult[]);
			} catch (parseError) {
				reject(
					new Error(
						`Failed to parse LangChain output: ${stdout}\nStderr: ${stderr}`,
					),
				);
			}
		});

		proc.on("error", (err: Error) => {
			reject(
				new Error(
					`Failed to spawn LangChain process: ${err.message}\n` +
						`Make sure Python is installed and LangChain is available:\n` +
						`  pip install langchain-text-splitters`,
				),
			);
		});

		// Write code to stdin
		proc.stdin.write(code);
		proc.stdin.end();
	});
}

/**
 * Check if LangChain text splitters are available.
 */
export async function isLangChainAvailable(
	pythonPath = "python3",
): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn(
			pythonPath,
			[
				"-c",
				"from langchain_text_splitters import RecursiveCharacterTextSplitter; print('ok')",
			],
			{
				stdio: ["ignore", "pipe", "pipe"],
			},
		);

		let stdout = "";

		proc.stdout.on("data", (data: Buffer) => {
			stdout += data.toString();
		});

		proc.on("close", (code: number | null) => {
			resolve(code === 0 && stdout.trim() === "ok");
		});

		proc.on("error", () => {
			resolve(false);
		});
	});
}
