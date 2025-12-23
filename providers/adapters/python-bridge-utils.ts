/**
 * Shared utilities for Python bridge adapters.
 * Consolidates common subprocess handling code used by chonkie, llamaindex, and langchain bridges.
 */

import { spawn } from "node:child_process";

export interface PythonBridgeResult<T> {
	error?: string;
	result?: T;
}

/**
 * Execute a Python script with stdin input and JSON output.
 *
 * @param scriptPath - Path to the Python script to execute
 * @param args - Command-line arguments for the Python script
 * @param stdin - String to write to the process stdin
 * @param pythonPath - Path to Python executable
 * @param bridgeName - Name of the bridge (for error messages)
 * @returns Promise resolving to parsed JSON output from the Python script
 */
export async function callPythonBridge<T>(
	scriptPath: string,
	args: string[],
	stdin: string,
	pythonPath: string,
	bridgeName: string,
): Promise<T> {
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
						`${bridgeName} bridge failed with exit code ${exitCode}: ${stderr || stdout}`,
					),
				);
				return;
			}

			try {
				const result = JSON.parse(stdout);
				if (result.error) {
					reject(new Error(`${bridgeName} error: ${result.error}`));
					return;
				}
				resolve(result as T);
			} catch (parseError) {
				reject(
					new Error(
						`Failed to parse ${bridgeName} output: ${stdout}\nStderr: ${stderr}`,
					),
				);
			}
		});

		proc.on("error", (err: Error) => {
			reject(
				new Error(
					`Failed to spawn ${bridgeName} process: ${err.message}`,
				),
			);
		});

		// Write input to stdin
		proc.stdin.write(stdin);
		proc.stdin.end();
	});
}

/**
 * Check if a Python package is available by attempting to import it.
 *
 * @param pythonPath - Path to Python executable
 * @param importStatement - Python import statement to test (e.g., "import chonkie")
 * @returns Promise resolving to true if package is available, false otherwise
 */
export async function isPythonPackageAvailable(
	pythonPath: string,
	importStatement: string,
): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn(pythonPath, ["-c", `${importStatement}; print('ok')`], {
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
