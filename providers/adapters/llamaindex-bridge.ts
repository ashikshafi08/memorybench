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

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
						`LlamaIndex bridge failed with exit code ${exitCode}: ${stderr || stdout}`,
					),
				);
				return;
			}

			try {
				const result = JSON.parse(stdout);
				if (result.error) {
					reject(new Error(`LlamaIndex error: ${result.error}`));
					return;
				}
				resolve(result as LlamaIndexChunkResult[]);
			} catch (parseError) {
				reject(
					new Error(
						`Failed to parse LlamaIndex output: ${stdout}\nStderr: ${stderr}`,
					),
				);
			}
		});

		proc.on("error", (err: Error) => {
			reject(
				new Error(
					`Failed to spawn LlamaIndex process: ${err.message}\n` +
						`Make sure Python is installed and LlamaIndex is available:\n` +
						`  pip install llama-index-core`,
				),
			);
		});

		// Write code to stdin
		proc.stdin.write(code);
		proc.stdin.end();
	});
}

/**
 * Check if LlamaIndex is available.
 */
export async function isLlamaIndexAvailable(
	pythonPath = "python3",
): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn(
			pythonPath,
			["-c", "from llama_index.core.node_parser import CodeSplitter; print('ok')"],
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
