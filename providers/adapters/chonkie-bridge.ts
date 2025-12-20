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

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
						`Chonkie bridge failed with exit code ${exitCode}: ${stderr || stdout}`,
					),
				);
				return;
			}

			try {
				const result = JSON.parse(stdout);
				if (result.error) {
					reject(new Error(`Chonkie error: ${result.error}`));
					return;
				}
				resolve(result as ChonkieChunkResult[]);
			} catch (parseError) {
				reject(
					new Error(
						`Failed to parse Chonkie output: ${stdout}\nStderr: ${stderr}`,
					),
				);
			}
		});

		proc.on("error", (err: Error) => {
			reject(
				new Error(
					`Failed to spawn Chonkie process: ${err.message}\n` +
						`Make sure Python is installed and Chonkie is available:\n` +
						`  pip install chonkie tree-sitter-language-pack`,
				),
			);
		});

		// Write code to stdin
		proc.stdin.write(code);
		proc.stdin.end();
	});
}

/**
 * Check if Chonkie is available.
 */
export async function isChonkieAvailable(
	pythonPath = "python3",
): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn(pythonPath, ["-c", "import chonkie; print('ok')"], {
			stdio: ["ignore", "pipe", "pipe"],
		});

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
