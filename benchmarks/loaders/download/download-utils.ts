/**
 * Shared Download Utilities
 *
 * Common infrastructure for downloading and extracting benchmark datasets.
 * Used by the dataset registry for consistent download behavior.
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";

// Resolve base path relative to this file
const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATASETS_BASE_DIR = join(__dirname, "..", "..", "datasets");

/**
 * Download a file from URL and save it.
 */
export async function downloadFile(url: string, destPath: string): Promise<void> {
	console.log(`Downloading from ${url}...`);

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to download: ${response.statusText}`);
	}

	const content = await response.text();
	await mkdir(dirname(destPath), { recursive: true });
	await writeFile(destPath, content);
	console.log(`Saved to ${destPath}`);
}

/**
 * Download a ZIP file and extract it.
 */
export async function downloadAndExtractZip(url: string, destDir: string): Promise<void> {
	console.log(`Downloading from ${url}...`);

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to download: ${response.statusText}`);
	}

	const arrayBuffer = await response.arrayBuffer();
	const tempZipPath = join(destDir, "_temp.zip");

	await mkdir(destDir, { recursive: true });
	await writeFile(tempZipPath, new Uint8Array(arrayBuffer));

	// Use unzip command
	const proc = Bun.spawn(["unzip", "-o", "-q", tempZipPath, "-d", destDir], {
		cwd: destDir,
	});
	await proc.exited;

	// Clean up temp file
	await Bun.spawn(["rm", tempZipPath]).exited;

	console.log(`Extracted to ${destDir}`);
}

/**
 * Read a JSONL file and parse each line.
 */
export async function readJsonl<T>(filePath: string): Promise<T[]> {
	const content = await readFile(filePath, "utf-8");
	const lines = content.trim().split("\n").filter(Boolean);
	return lines.map((line) => JSON.parse(line) as T);
}

/**
 * Read a JSON file.
 */
export async function readJson<T>(filePath: string): Promise<T> {
	const content = await readFile(filePath, "utf-8");
	return JSON.parse(content) as T;
}

/**
 * Apply range and limit filters to an array.
 */
export function applyFilters<T>(
	items: T[],
	options?: { limit?: number; start?: number; end?: number },
): T[] {
	let filtered = items;

	if (options?.start !== undefined || options?.end !== undefined) {
		const start = (options?.start ?? 1) - 1; // Convert to 0-indexed
		const end = options?.end ?? items.length;
		filtered = items.slice(start, end);
	}

	if (options?.limit !== undefined) {
		filtered = filtered.slice(0, options.limit);
	}

	return filtered;
}

/**
 * Clone a GitHub repository to a directory (shallow clone for speed).
 * Used for downloading benchmark repos that don't have pre-packaged zips.
 * 
 * @param githubRepo - Repo in format "owner/name" or "owner_name" (first underscore separates owner/repo)
 * @param destDir - Directory to clone into
 */
export async function cloneGitHubRepo(
	githubRepo: string,
	destDir: string,
): Promise<void> {
	// Convert owner_name format to owner/name for GitHub URL
	// Only replace the FIRST underscore to handle repo names with underscores
	const repoPath = githubRepo.includes("/") 
		? githubRepo 
		: githubRepo.replace(/^([^_]+)_(.+)$/, "$1/$2");
	
	const repoUrl = `https://github.com/${repoPath}.git`;
	
	console.log(`  Cloning ${repoPath}...`);
	
	// Use shallow clone for faster download
	const proc = Bun.spawn(
		["git", "clone", "--depth", "1", repoUrl, destDir],
		{ stdout: "pipe", stderr: "pipe" },
	);
	
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		const stderr = await new Response(proc.stderr).text();
		throw new Error(`Failed to clone ${repoPath}: ${stderr}`);
	}
	
	console.log(`  Cloned to ${destDir}`);
}

/**
 * Clone a git repository using bare clone + worktree pattern.
 * Returns the worktree directory path.
 */
export async function cloneRepoWithWorktree(
	repo: string,
	commit: string,
	reposDir: string,
): Promise<string> {
	await mkdir(reposDir, { recursive: true });

	// Sanitize repo name for directory
	const repoName = repo.replace("/", "_");
	const bareDir = join(reposDir, `${repoName}.git`);
	const worktreeDir = join(reposDir, repoName, commit.slice(0, 8));

	// Clone bare repository if not exists
	if (!existsSync(bareDir)) {
		console.log(`Cloning ${repo}...`);
		const cloneProc = Bun.spawn(
			["git", "clone", "--bare", `https://github.com/${repo}.git`, bareDir],
			{ stdout: "pipe", stderr: "pipe" },
		);
		const exitCode = await cloneProc.exited;
		if (exitCode !== 0) {
			const stderr = await new Response(cloneProc.stderr).text();
			throw new Error(`Failed to clone ${repo}: ${stderr}`);
		}
	}

	// Create worktree for specific commit if not exists
	if (!existsSync(worktreeDir)) {
		console.log(`Checking out ${commit.slice(0, 8)}...`);

		// Create parent directory
		await mkdir(dirname(worktreeDir), { recursive: true });

		const worktreeProc = Bun.spawn(
			["git", "worktree", "add", worktreeDir, commit],
			{ cwd: bareDir, stdout: "pipe", stderr: "pipe" },
		);
		const exitCode = await worktreeProc.exited;
		if (exitCode !== 0) {
			const stderr = await new Response(worktreeProc.stderr).text();
			throw new Error(`Failed to create worktree: ${stderr}`);
		}
	}

	return worktreeDir;
}

/**
 * Find files with specific extensions in a directory.
 */
export function findFilesWithExtensions(
	dir: string,
	extensions: Set<string>,
	skipDirs: Set<string> = new Set([".git", "node_modules", "__pycache__", ".venv", "venv"]),
	maxFiles = 5000,
): string[] {
	const { readdirSync, statSync } = require("node:fs");
	const { join: pathJoin } = require("node:path");
	const files: string[] = [];

	function walk(currentDir: string) {
		if (files.length >= maxFiles) return;

		try {
			const entries = readdirSync(currentDir);
			for (const entry of entries) {
				if (files.length >= maxFiles) break;
				if (skipDirs.has(entry)) continue;

				const fullPath = pathJoin(currentDir, entry);
				try {
					const stat = statSync(fullPath);
					if (stat.isDirectory()) {
						walk(fullPath);
					} else {
						const ext = entry.slice(entry.lastIndexOf("."));
						if (extensions.has(ext)) {
							files.push(fullPath);
						}
					}
				} catch {
					// Skip inaccessible files
				}
			}
		} catch {
			// Skip inaccessible directories
		}
	}

	walk(dir);
	return files;
}

/**
 * HuggingFace Datasets Server API response structure.
 */
interface HuggingFaceRowsResponse {
	rows: Array<{ row: Record<string, unknown> }>;
}

/**
 * HuggingFace Parquet API response structure.
 */
interface HuggingFaceParquetResponse {
	parquet_files: Array<{
		dataset: string;
		config: string;
		split: string;
		url: string;
		filename: string;
		size: number;
	}>;
	pending: string[];
	failed: string[];
	partial: boolean;
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with retry and exponential backoff for rate limiting.
 * Includes jitter to avoid thundering herd problem.
 */
async function fetchWithRetry(
	url: string,
	maxRetries: number = 8,
	initialDelayMs: number = 1000,
): Promise<Response> {
	let lastError: Error | null = null;

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			const response = await fetch(url);

			if (response.status === 429) {
				// Rate limited - wait and retry with exponential backoff + jitter
				const jitter = Math.random() * 500;
				const delayMs = Math.min(initialDelayMs * Math.pow(2, attempt) + jitter, 60000);
				console.log(`  Rate limited, waiting ${(delayMs / 1000).toFixed(1)}s before retry...`);
				await sleep(delayMs);
				continue;
			}

			if (!response.ok) {
				throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
			}

			return response;
		} catch (error) {
			lastError = error as Error;
			if (attempt < maxRetries - 1) {
				const jitter = Math.random() * 500;
				const delayMs = Math.min(initialDelayMs * Math.pow(2, attempt) + jitter, 60000);
				console.log(`  Request failed, retrying in ${(delayMs / 1000).toFixed(1)}s...`);
				await sleep(delayMs);
			}
		}
	}

	throw lastError || new Error("Max retries exceeded");
}

/**
 * Fetch dataset from HuggingFace Datasets Server API.
 * This API returns JSON data, avoiding the need to parse Parquet files.
 * Includes retry logic and rate limiting handling.
 */
export async function fetchHuggingFaceDataset(params: {
	dataset: string;
	config?: string;
	split?: string;
	maxRows?: number;
}): Promise<any[]> {
	const { dataset, config = "default", split = "test", maxRows = 10000 } = params;
	const allRows: any[] = [];
	let offset = 0;
	const batchSize = 100;
	const delayBetweenRequests = 500; // 500ms delay between requests to avoid rate limits

	console.log(`Fetching ${dataset} (config: ${config}, split: ${split})...`);

	while (allRows.length < maxRows) {
		const url = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(dataset)}&config=${encodeURIComponent(config)}&split=${encodeURIComponent(split)}&offset=${offset}&length=${batchSize}`;
		
		try {
			const response = await fetchWithRetry(url);
			const data = await response.json() as HuggingFaceRowsResponse;
			
			if (!data.rows || data.rows.length === 0) {
				break;
			}
			
			const rows = data.rows.map((r) => r.row);
			allRows.push(...rows);
			
			console.log(`  Fetched ${allRows.length} rows...`);
			
			// If we got fewer rows than requested, we've reached the end
			if (rows.length < batchSize) {
				break;
			}
			
			offset += batchSize;
			
			// Small delay between requests to avoid rate limiting
			await sleep(delayBetweenRequests);
		} catch (error) {
			throw new Error(`Error fetching ${dataset} at offset ${offset}: ${error}`);
		}
	}

	console.log(`  Total rows fetched: ${allRows.length}`);
	return allRows;
}

/**
 * Download dataset via HuggingFace Parquet API (no rate limiting).
 * 
 * This method:
 * 1. Gets parquet file URLs from the HuggingFace parquet API
 * 2. Downloads the parquet files directly (no rate limits)
 * 3. Uses Python to convert parquet to JSON records
 * 
 * Much more reliable than the rows API for large datasets.
 */
export async function fetchHuggingFaceDatasetViaParquet(params: {
	dataset: string;
	config?: string;
	split?: string;
}): Promise<any[]> {
	const { dataset, config = "default", split = "test" } = params;
	
	console.log(`Fetching ${dataset} via Parquet API (no rate limiting)...`);
	
	// Step 1: Get parquet file URLs
	const parquetApiUrl = `https://datasets-server.huggingface.co/parquet?dataset=${encodeURIComponent(dataset)}`;
	const response = await fetchWithRetry(parquetApiUrl);
	const parquetInfo = await response.json() as HuggingFaceParquetResponse;
	
	// Filter to requested config and split
	const matchingFiles = parquetInfo.parquet_files.filter(
		(f) => f.config === config && f.split === split
	);
	
	if (matchingFiles.length === 0) {
		// Try to find any available config/split
		const availableConfigs = [...new Set(parquetInfo.parquet_files.map(f => f.config))];
		const availableSplits = [...new Set(parquetInfo.parquet_files.map(f => f.split))];
		throw new Error(
			`No parquet files found for config="${config}", split="${split}". ` +
			`Available configs: [${availableConfigs.join(", ")}], splits: [${availableSplits.join(", ")}]`
		);
	}
	
	console.log(`  Found ${matchingFiles.length} parquet file(s)`);
	
	// Step 2: Download parquet files to temp directory
	const tempDir = join(DATASETS_BASE_DIR, "_temp_parquet");
	await mkdir(tempDir, { recursive: true });
	
	const downloadedFiles: string[] = [];
	for (let i = 0; i < matchingFiles.length; i++) {
		const file = matchingFiles[i]!;
		const localPath = join(tempDir, `${dataset.replace("/", "_")}_${i}.parquet`);
		
		console.log(`  Downloading parquet ${i + 1}/${matchingFiles.length}: ${file.filename}`);
		const fileResponse = await fetch(file.url);
		if (!fileResponse.ok) {
			throw new Error(`Failed to download parquet: ${fileResponse.statusText}`);
		}
		
		const buffer = await fileResponse.arrayBuffer();
		await writeFile(localPath, new Uint8Array(buffer));
		downloadedFiles.push(localPath);
	}
	
	// Step 3: Use Python to convert parquet to JSON
	const allRecords: any[] = [];
	for (const parquetPath of downloadedFiles) {
		const records = await parquetToJson(parquetPath);
		allRecords.push(...records);
	}
	
	// Cleanup temp files
	for (const file of downloadedFiles) {
		try {
			await Bun.spawn(["rm", file]).exited;
		} catch { /* ignore */ }
	}
	
	console.log(`  Total records: ${allRecords.length}`);
	return allRecords;
}

/**
 * Convert a parquet file to JSON records using hyparquet (pure TypeScript).
 */
async function parquetToJson(parquetPath: string): Promise<any[]> {
	const file = await asyncBufferFromFile(parquetPath);
	const data = await parquetReadObjects({ file, compressors });
	return data;
}

/**
 * Download a raw file from HuggingFace Hub.
 * Uses the resolve endpoint to download files directly.
 */
export async function downloadHuggingFaceRawFile(params: {
	dataset: string;
	filename: string;
	destPath: string;
	branch?: string;
}): Promise<void> {
	const { dataset, filename, destPath, branch = "main" } = params;

	console.log(`Downloading ${filename} from HuggingFace ${dataset}...`);

	// HuggingFace Hub raw file URL format
	const url = `https://huggingface.co/datasets/${dataset}/resolve/${branch}/${filename}`;

	const response = await fetchWithRetry(url);
	const content = await response.text();

	await mkdir(dirname(destPath), { recursive: true });
	await writeFile(destPath, content);

	console.log(`Saved to ${destPath}`);
}

/**
 * Download a raw file from GitHub.
 */
export async function downloadGitHubRawFile(params: {
	repo: string;
	path: string;
	destPath: string;
	branch?: string;
}): Promise<void> {
	const { repo, path, destPath, branch = "main" } = params;

	console.log(`Downloading ${path} from GitHub ${repo}...`);

	// GitHub raw file URL format
	const url = `https://raw.githubusercontent.com/${repo}/${branch}/${path}`;

	const response = await fetchWithRetry(url);
	const content = await response.text();

	await mkdir(dirname(destPath), { recursive: true });
	await writeFile(destPath, content);

	console.log(`Saved to ${destPath}`);
}
