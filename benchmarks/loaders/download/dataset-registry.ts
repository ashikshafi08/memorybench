/**
 * Dataset Registry
 *
 * Consolidated dataset definitions for code retrieval benchmarks.
 * Each dataset has custom download logic, task parsing, and context building.
 *
 * Configuration is loaded from datasets.yaml for URLs, repos, and task types.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BenchmarkItem, PreparedData } from "../../../core/config.ts";
import { mkdir } from "node:fs/promises";
import {
	DATASETS_BASE_DIR,
	downloadFile,
	downloadAndExtractZip,
	readJsonl,
	readJson,
	cloneRepoWithWorktree,
	cloneGitHubRepo,
	findFilesWithExtensions,
	fetchHuggingFaceDataset,
	fetchHuggingFaceDatasetViaParquet,
} from "./download-utils.ts";
import {
	getDatasetConfig,
	getRepoListForTaskType,
	getTaskTypeConfig,
	getSourceConfig,
	getLanguageConfig,
	getSupportedLanguages,
	getConfiguredDatasetNames,
} from "./yaml-config.ts";

// ============================================================================
// Types
// ============================================================================

export interface DatasetDefinition {
	name: string;
	dataDir: string;
	envVar: string;

	/** Check if dataset is available locally */
	isAvailable: () => boolean;

	/** Download dataset if not present */
	download: (options?: { taskType?: "function" | "line" | "api" }) => Promise<void>;

	/** Load raw tasks from dataset */
	loadTasks: (options?: { 
		language?: string;
		/** Task type for RepoEval: "function" (default), "line", or "api" */
		taskType?: "function" | "line" | "api";
	}) => Promise<RawTask[]>;

	/** Convert task to BenchmarkItem with contexts */
	toBenchmarkItem: (task: RawTask, options?: {
		reposDir?: string;
		taskType?: string;
		hardNegatives?: {
			enabled: boolean;
			strategy: "cross-repo" | "same-repo" | "bm25" | "embedding";
			count: number;
			maxFilesPerRepo: number;
		};
		/**
		 * Exclude the target file from contexts.
		 * 
		 * When true, the file containing the ground truth is NOT included in the corpus.
		 * This tests whether the model can find RELATED code (cross-file retrieval)
		 * rather than finding the SAME code (trivially easy with embedding similarity).
		 * 
		 * Use case: Makes code retrieval benchmarks much harder and more realistic.
		 * Without this, the query (code prefix) is essentially searching for itself.
		 */
		excludeTargetFile?: boolean;
		
		/**
		 * IoU (Intersection over Union) threshold for line-range relevance.
		 * 
		 * This controls how precisely a retrieved chunk must align with the ground truth:
		 *   0.0 (default): Any line overlap counts as relevant (binary overlap)
		 *   0.3: ~30% overlap required (lenient)
		 *   0.5: ~50% overlap required (recommended for chunking evaluation)
		 *   0.7: ~70% overlap required (strict)
		 * 
		 * Passed to the pack's relevance checker via item.metadata.iouThreshold
		 */
		iouThreshold?: number;
	}) => Promise<BenchmarkItem>;
}

export interface RawTask {
	id: string;
	[key: string]: unknown;
}

// ============================================================================
// RepoEval Dataset
// ============================================================================

// Repo list now loaded from datasets.yaml via getRepoListForTaskType()

interface RepoEvalRawTask extends RawTask {
	prompt: string;
	metadata: {
		task_id: string;
		ground_truth: string;
		fpath_tuple: string[];
		line_no: number;
		lineno: number;
		context_start_lineno: number;
	};
}

function createRepoEvalDataset(): DatasetDefinition {
	const config = getDatasetConfig("repoeval")!;
	const dataDir = () => process.env[config.envVar] || join(DATASETS_BASE_DIR, "repoeval");
	const datasetsDir = () => join(dataDir(), "datasets");
	// Note: The function_level.zip extracts repos directly to repositories/, not repositories/function_level/
	// Line and API levels extract to repositories/line/ and repositories/api/ respectively
	const reposDir = (taskType?: string) => {
		if (taskType === "line") return join(dataDir(), "repositories/line");
		if (taskType === "api") return join(dataDir(), "repositories/api");
		return join(dataDir(), "repositories"); // function (default)
	};

	return {
		name: "repoeval",
		dataDir: dataDir(),
		envVar: config.envVar,

		isAvailable: () => existsSync(datasetsDir()) && existsSync(reposDir("function")),

		download: async (options) => {
			const taskType = options?.taskType ?? "function";
			console.log(`Downloading RepoEval benchmark data (task type: ${taskType})...\n`);

			// Download datasets (shared across all task types)
			if (!existsSync(datasetsDir())) {
				const datasetsSource = getSourceConfig("repoeval", "datasets")!;
				await downloadAndExtractZip(datasetsSource.url!, datasetsDir());
			}

			// Download repositories for specific task type
			const taskConfig = getTaskTypeConfig("repoeval", taskType);
			if (taskConfig) {
				const reposDest = join(dataDir(), taskConfig.repos.extractTo!);
				if (!existsSync(reposDest)) {
					// Try ZIP download first
					try {
						await downloadAndExtractZip(taskConfig.repos.url!, reposDest);
					} catch (zipError) {
						// ZIP doesn't exist - clone repos from GitHub instead
						console.log(`\nZIP not available, cloning repositories from GitHub...`);
						await mkdir(reposDest, { recursive: true });
						
						const repoList = getRepoListForTaskType("repoeval", taskType);
						for (const repoName of repoList) {
							const repoDir = join(reposDest, repoName);
							if (!existsSync(repoDir)) {
								try {
									await cloneGitHubRepo(repoName, repoDir);
								} catch (cloneError) {
									console.warn(`  Warning: Failed to clone ${repoName}: ${cloneError}`);
								}
							}
						}
					}
				}
			}

			console.log("\nDownload complete!");
		},

		loadTasks: async (options) => {
			const contextLength = options?.language || "2k";
			// Support different task types: function (default), line, api
			const taskType = options?.taskType || "function";
			const fileName = `${taskType}_level_completion_${contextLength}_context_codex.test.jsonl`;
			const filePath = join(datasetsDir(), fileName);

			if (!existsSync(filePath)) {
				throw new Error(`RepoEval dataset not found at ${filePath}`);
			}

			const content = await readFile(filePath, "utf-8");
			const lines = content.trim().split("\n");
			const tasks: RepoEvalRawTask[] = [];
			const repo2idx: Record<string, number> = {};

			// Get valid repos from YAML config
			const validRepos = new Set(getRepoListForTaskType("repoeval", taskType));

			for (const line of lines) {
				const task = JSON.parse(line) as RepoEvalRawTask;
				const repo = task.metadata.task_id.replace("--", "_").split("/")[0];
				if (!repo) continue;
				
				// Check if repo is in the valid list for this task type
				// If validRepos is empty, accept any downloaded repo
				if (validRepos.size > 0 && !validRepos.has(repo)) {
					continue;
				}

				// Check if repo is downloaded (use taskType-specific path)
				const repoPath = join(reposDir(taskType), repo);
				if (!existsSync(repoPath)) {
					continue; // Repo not downloaded
				}

				if (!(repo in repo2idx)) repo2idx[repo] = 0;

				task.metadata.task_id = task.metadata.task_id
					.replace("--", "_")
					.replace("idx", String(repo2idx[repo] ?? 0));
				task.metadata.line_no = task.metadata.lineno;
				task.id = task.metadata.task_id;
				repo2idx[repo] = (repo2idx[repo] ?? 0) + 1;

				tasks.push(task);
			}

			return tasks;
		},

		toBenchmarkItem: async (task, options?) => {
			const t = task as RepoEvalRawTask;
			// Extract repo name: normalize "--" to "_" to match directory names
			// (task_id is normalized in loadTasks, but handle both cases for safety)
			const repo = t.metadata.task_id.replace("--", "_").split("/")[0]!;
			const taskType = options?.taskType || "function";
			const repoDir = join(reposDir(taskType), repo);

			// Extract target file path early (needed for exclusion check)
			const targetFile = t.metadata.fpath_tuple.slice(1).join("/");

			// Load all Python files from the repo
			const pyFiles = findFilesWithExtensions(repoDir, new Set([".py"]));
			const contexts: PreparedData[] = [];

			for (const filepath of pyFiles) {
				try {
					const content = await readFile(filepath, "utf-8");
					const relPath = filepath.replace(`${repoDir}/`, "");
					
					// Skip target file if excludeTargetFile is enabled
					// This makes the benchmark test cross-file retrieval (finding RELATED code)
					// rather than same-file retrieval (trivially finding the query's own file)
					if (options?.excludeTargetFile && relPath === targetFile) {
						continue;
					}
					
					contexts.push({
						id: `${repo}:${relPath}`,
						content,
						metadata: { filepath: relPath, repo, absolutePath: filepath },
					});
				} catch { /* skip */ }
			}

			// Add hard negatives if configured
			if (options?.hardNegatives?.enabled) {
				const { generateHardNegatives } = await import("../hard-negatives.ts");
				const hardNegs = await generateHardNegatives({
					currentRepo: repo,
					reposDir: reposDir(taskType),
					config: options.hardNegatives,
					taskType: taskType,
					query: t.prompt,  // Pass query for BM25/embedding strategies
					targetFile,       // Exclude target file from negatives
					existingContexts: contexts,
				});
				contexts.push(...hardNegs);
			}
			return {
				id: t.metadata.task_id,
				question: t.prompt,
				answer: t.metadata.ground_truth,
				contexts,
				metadata: {
					repo,
					groundTruth: {
						file: targetFile,
						startLine: t.metadata.context_start_lineno,
						endLine: t.metadata.line_no,
					},
					targetFile,
					startLine: t.metadata.context_start_lineno,
					endLine: t.metadata.line_no,
					// IoU threshold for relevance checking (passed to pack via metadata)
					iouThreshold: options?.iouThreshold,
				},
			};
		},
	};
}

// ============================================================================
// RepoBench-R Dataset
// ============================================================================

interface RepoBenchRRawTask extends RawTask {
	file_context: string;
	cross_file_context: string[];
	next_line: string;
	language: "python" | "java";
	repo_name: string;
}

function createRepoBenchRDataset(): DatasetDefinition {
	const config = getDatasetConfig("repobench-r")!;
	const dataDir = () => process.env[config.envVar] || join(DATASETS_BASE_DIR, "repobench-r");

	return {
		name: "repobench-r",
		dataDir: dataDir(),
		envVar: config.envVar,

		isAvailable: () => {
			const pythonPath = join(dataDir(), "python.jsonl");
			const javaPath = join(dataDir(), "java.jsonl");
			return existsSync(pythonPath) || existsSync(javaPath);
		},

		download: async () => {
			console.log("Downloading RepoBench-R benchmark data...\n");

			// Get languages from YAML config
			const languages = getSupportedLanguages("repobench-r");
			for (const lang of languages) {
				const langConfig = getLanguageConfig("repobench-r", lang);
				if (!langConfig) continue;

				const destPath = join(dataDir(), langConfig.outputFile);
				if (existsSync(destPath)) {
					console.log(`${langConfig.outputFile} already exists, skipping...`);
					continue;
				}

				try {
					// Use Parquet API (no rate limiting) from YAML config
					const source = langConfig.source;
					const tasks = await fetchHuggingFaceDatasetViaParquet({
						dataset: source.dataset!,
						config: source.config ?? "default",
						split: source.split ?? "test",
					});

					// Convert to JSONL format (one JSON object per line)
					// Use replacer to handle BigInt values from parquet
					const jsonlContent = tasks.map((task) => 
						JSON.stringify(task, (_, v) => typeof v === "bigint" ? Number(v) : v)
					).join("\n");
					const { mkdir, writeFile } = await import("node:fs/promises");
					await mkdir(dataDir(), { recursive: true });
					await writeFile(destPath, jsonlContent);
					console.log(`Saved ${langConfig.outputFile} with ${tasks.length} samples`);
				} catch (error) {
					console.warn(`Failed to download ${lang}: ${error}`);
				}
			}

			console.log("\nDownload complete!");
		},

		loadTasks: async (options) => {
			const language = options?.language || "python";
			const languages = language === "all" ? ["python", "java"] : [language];
			const tasks: RepoBenchRRawTask[] = [];

			for (const lang of languages) {
				const filePath = join(dataDir(), `${lang}.jsonl`);
				if (!existsSync(filePath)) continue;

				const content = await readFile(filePath, "utf-8");
				const lines = content.trim().split("\n").filter(Boolean);

				for (let i = 0; i < lines.length; i++) {
					try {
						const raw = JSON.parse(lines[i]!) as any;
						tasks.push({
							id: `${lang}-${i}`,
							file_context: raw.in_file_context || raw.context || raw.file_content,
							cross_file_context: raw.cross_file_context || [],
							next_line: raw.next_line,
							language: lang as "python" | "java",
							repo_name: raw.repo_name,
						});
					} catch { /* skip */ }
				}
			}

			return tasks;
		},

		toBenchmarkItem: async (task) => {
			const t = task as RepoBenchRRawTask;

			// Create contexts from gold snippets
			const contexts: PreparedData[] = t.cross_file_context.map((snippet, idx) => ({
				id: `${t.id}-snippet-${idx}`,
				content: snippet,
				metadata: { snippetIndex: idx, isGoldSnippet: true, repo: t.repo_name },
			}));

			return {
				id: t.id,
				question: t.file_context,
				answer: t.next_line,
				contexts,
				metadata: {
					language: t.language,
					repo: t.repo_name,
					goldSnippets: t.cross_file_context,
					goldSnippetCount: t.cross_file_context.length,
				},
			};
		},
	};
}

// ============================================================================
// CrossCodeEval Dataset
// ============================================================================

interface CrossCodeEvalRawTask extends RawTask {
	language: string;
	repo: string;
	file_path: string;
	context: string;
	completion: string;
	cross_file_context: Array<{ file: string; content: string }>;
	imports: string[];
}

function parseCrossFileContext(raw: string): Array<{ file: string; content: string }> {
	if (!raw || raw === "null" || raw === "[]") return [];

	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			return parsed.map((item, idx) => {
				if (typeof item === "object" && item !== null) {
					return {
						file: item.file || item.path || `context_${idx}`,
						content: item.content || item.code || String(item),
					};
				}
				return { file: `context_${idx}`, content: String(item) };
			});
		}
		if (typeof parsed === "object" && parsed !== null) {
			return Object.entries(parsed).map(([file, content]) => ({
				file,
				content: String(content),
			}));
		}
	} catch {
		if (raw.trim()) return [{ file: "context_0", content: raw }];
	}

	return [];
}

function createCrossCodeEvalDataset(): DatasetDefinition {
	const config = getDatasetConfig("crosscodeeval")!;
	const dataDir = () => process.env[config.envVar] || join(DATASETS_BASE_DIR, "crosscodeeval");

	return {
		name: "crosscodeeval",
		dataDir: dataDir(),
		envVar: config.envVar,

		isAvailable: () => existsSync(join(dataDir(), "python.jsonl")),

		download: async () => {
			console.log("Downloading CrossCodeEval benchmark data...\n");

			// Download tar.xz archive from Amazon Science cceval GitHub repo
			// HuggingFace API has schema validation issues for this dataset
			const { mkdir, writeFile, readdir, copyFile } = await import("node:fs/promises");
			await mkdir(dataDir(), { recursive: true });

			// Get languages from YAML config
			const languages = getSupportedLanguages("crosscodeeval");
			const allExist = languages.every((lang) => existsSync(join(dataDir(), `${lang}.jsonl`)));
			if (allExist) {
				console.log("All CrossCodeEval data files already exist, skipping download.");
				return;
			}

			// Download the tar.xz archive from YAML config
			const source = config.source!;
			const archivePath = join(dataDir(), "crosscodeeval_data.tar.xz");

			if (!existsSync(archivePath)) {
				console.log("Downloading CrossCodeEval archive from GitHub...");
				const response = await fetch(source.url!);
				if (!response.ok) {
					throw new Error(`Failed to fetch archive: ${response.status} ${response.statusText}`);
				}
				const buffer = await response.arrayBuffer();
				await writeFile(archivePath, new Uint8Array(buffer));
				console.log("Archive downloaded.");
			}

			// Extract the archive
			console.log("Extracting archive...");
			const extractProc = Bun.spawn(["tar", "-xJf", archivePath, "-C", dataDir()], {
				cwd: dataDir(),
				stdout: "pipe",
				stderr: "pipe",
			});
			const exitCode = await extractProc.exited;
			if (exitCode !== 0) {
				const stderr = await new Response(extractProc.stderr).text();
				throw new Error(`Failed to extract archive: ${stderr}`);
			}

			// Find and copy the JSONL files using postExtract pattern from YAML
			const postExtract = config.postExtract;
			for (const lang of languages) {
				const srcPattern = postExtract?.pattern.replace("{lang}", lang) ?? `${lang}/line_completion_oracle_bm25.jsonl`;
				const destPattern = postExtract?.outputPattern.replace("{lang}", lang) ?? `${lang}.jsonl`;
				
				const srcPath = join(dataDir(), srcPattern);
				const destPath = join(dataDir(), destPattern);

				if (existsSync(srcPath) && !existsSync(destPath)) {
					await copyFile(srcPath, destPath);
					const content = await readFile(destPath, "utf-8");
					const lineCount = content.trim().split("\n").length;
					console.log(`Saved ${destPattern} with ${lineCount} samples`);
				} else if (!existsSync(srcPath)) {
					console.warn(`Source file not found: ${srcPath}`);
				}
			}

			console.log("\nDownload complete!");
		},

		loadTasks: async (options) => {
			const language = options?.language || "python";
			// Get languages from YAML config
			const configLanguages = getSupportedLanguages("crosscodeeval");
			const languages = language === "all" ? configLanguages : [language];
			const tasks: CrossCodeEvalRawTask[] = [];

			for (const lang of languages) {
				const filePath = join(dataDir(), `${lang}.jsonl`);
				if (!existsSync(filePath)) continue;

				const content = await readFile(filePath, "utf-8");
				const lines = content.trim().split("\n").filter(Boolean);

				for (let i = 0; i < lines.length; i++) {
					try {
						const raw = JSON.parse(lines[i]!) as any;
						const crossFileContext = parseCrossFileContext(raw.cross_file_context);

						let imports: string[] = [];
						if (raw.imports) {
							try {
								imports = JSON.parse(raw.imports);
							} catch {
								imports = raw.imports.split("\n").filter(Boolean);
							}
						}

						tasks.push({
							id: `${lang}-${raw.idx || i}`,
							language: lang,
							repo: raw.repo,
							file_path: raw.file_path,
							context: raw.context,
							completion: raw.completion,
							cross_file_context: crossFileContext,
							imports,
						});
					} catch { /* skip */ }
				}
			}

			return tasks;
		},

		toBenchmarkItem: async (task) => {
			const t = task as CrossCodeEvalRawTask;

			// Create contexts from cross-file dependencies
			const contexts: PreparedData[] = t.cross_file_context.map((dep, idx) => ({
				id: `${t.id}-dep-${idx}`,
				content: dep.content,
				metadata: {
					filepath: dep.file,
					dependencyIndex: idx,
					isOracleDependency: true,
					repo: t.repo,
				},
			}));

			const dependencyFiles = t.cross_file_context.map((dep) => dep.file);

			return {
				id: t.id,
				question: t.context,
				answer: t.completion,
				contexts,
				metadata: {
					language: t.language,
					repo: t.repo,
					filePath: t.file_path,
					dependencyFiles,
					dependencyCount: dependencyFiles.length,
					imports: t.imports,
				},
			};
		},
	};
}

// ============================================================================
// SWE-bench Lite Dataset
// ============================================================================

interface SWEBenchRawTask extends RawTask {
	instance_id: string;
	repo: string;
	base_commit: string;
	patch: string;
	test_patch: string;
	problem_statement: string;
	hints_text: string;
	version: string;
}

interface PatchFile {
	filepath: string;
	additions: number;
	deletions: number;
}

function parsePatch(patch: string): PatchFile[] {
	const files: PatchFile[] = [];
	const lines = patch.split("\n");
	let currentFile: PatchFile | null = null;

	for (const line of lines) {
		const diffMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
		if (diffMatch) {
			if (currentFile) files.push(currentFile);
			currentFile = { filepath: diffMatch[2]!, additions: 0, deletions: 0 };
			continue;
		}

		if (currentFile && line.startsWith("+") && !line.startsWith("+++")) {
			currentFile.additions++;
		} else if (currentFile && line.startsWith("-") && !line.startsWith("---")) {
			currentFile.deletions++;
		}
	}

	if (currentFile) files.push(currentFile);
	return files;
}

const SOURCE_EXTENSIONS = new Set([
	".py", ".java", ".js", ".ts", ".jsx", ".tsx", ".go", ".rs", ".c", ".cpp", ".h", ".hpp",
]);

const SKIP_DIRS = new Set([
	".git", "node_modules", "__pycache__", ".venv", "venv", ".tox", "build", "dist", ".eggs",
]);

function createSWEBenchLiteDataset(): DatasetDefinition {
	const config = getDatasetConfig("swebench-lite")!;
	const dataDir = () => process.env[config.envVar] || join(DATASETS_BASE_DIR, "swebench-lite");
	const reposDir = () => join(dataDir(), "repos");

	return {
		name: "swebench-lite",
		dataDir: dataDir(),
		envVar: config.envVar,

		isAvailable: () => existsSync(join(dataDir(), config.outputFile ?? "swebench-lite.json")),

		download: async () => {
			console.log("Downloading SWE-bench Lite benchmark data...\n");

			const destPath = join(dataDir(), config.outputFile ?? "swebench-lite.json");
			if (existsSync(destPath)) {
				console.log("SWE-bench Lite data already exists, skipping...");
				return;
			}

			// Use HuggingFace Datasets Server API from YAML config
			const source = config.source!;
			const tasks = await fetchHuggingFaceDataset({
				dataset: source.dataset!,
				config: source.config ?? "default",
				split: source.split ?? "test",
				maxRows: source.maxRows ?? 10000,
			});

			const { mkdir, writeFile } = await import("node:fs/promises");
			await mkdir(dataDir(), { recursive: true });
			await writeFile(destPath, JSON.stringify(tasks, null, 2));

			console.log("\nDownload complete!");
		},

		loadTasks: async () => {
			const dataPath = join(dataDir(), "swebench-lite.json");
			if (!existsSync(dataPath)) {
				throw new Error(`SWE-bench Lite data not found at ${dataPath}`);
			}

			const content = await readFile(dataPath, "utf-8");
			const tasks = JSON.parse(content) as SWEBenchRawTask[];
			return tasks.map((t) => ({ ...t, id: t.instance_id }));
		},

		toBenchmarkItem: async (task) => {
			const t = task as SWEBenchRawTask;

			// Parse patch to get modified files
			const patchFiles = parsePatch(t.patch);
			const modifiedFiles = patchFiles.map((p) => p.filepath);

			// Clone repository
			const repoDir = await cloneRepoWithWorktree(t.repo, t.base_commit, reposDir());

			// Load all source files
			const sourceFiles = findFilesWithExtensions(repoDir, SOURCE_EXTENSIONS, SKIP_DIRS);
			const contexts: PreparedData[] = [];

			for (const filepath of sourceFiles) {
				try {
					const content = await readFile(filepath, "utf-8");
					const relPath = filepath.replace(`${repoDir}/`, "");
					contexts.push({
						id: `${t.repo}:${relPath}`,
						content,
						metadata: { filepath: relPath, repo: t.repo, absolutePath: filepath },
					});
				} catch { /* skip */ }
			}

			return {
				id: t.instance_id,
				question: t.problem_statement,
				answer: t.patch,
				contexts,
				metadata: {
					repo: t.repo,
					baseCommit: t.base_commit,
					modifiedFiles,
					patchFiles,
					hints: t.hints_text,
					version: t.version,
				},
			};
		},
	};
}

// ============================================================================
// Registry
// ============================================================================

const DATASETS: Record<string, DatasetDefinition> = {
	repoeval: createRepoEvalDataset(),
	"repobench-r": createRepoBenchRDataset(),
	crosscodeeval: createCrossCodeEvalDataset(),
	"swebench-lite": createSWEBenchLiteDataset(),
};

export function getDataset(name: string): DatasetDefinition | undefined {
	return DATASETS[name];
}

export function getDatasetNames(): string[] {
	return Object.keys(DATASETS);
}

export { parsePatch, type PatchFile };
