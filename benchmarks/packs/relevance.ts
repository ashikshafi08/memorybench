/**
 * Shared Ground-Truth Matchers for Code Retrieval Benchmarks
 *
 * Reusable relevance primitives for determining if a retrieved chunk is relevant
 * to a ground-truth target. Each benchmark uses one or more of these matchers
 * in its pack's `isRelevant()` implementation.
 *
 * Mapping Table:
 *   - RepoEval       → lineRangeOverlaps (file match + line-range IoU)
 *   - RepoBench-R    → isJaccardMatch (content-based Jaccard similarity ≥ threshold)
 *   - SWE-bench Lite → fileMatches (patch file list membership, optional line overlap)
 *   - CrossCodeEval  → crossFileCoverage (dependency file coverage)
 */

/**
 * Line range span (1-indexed, inclusive).
 */
export interface LineSpan {
	startLine: number;
	endLine: number;
}

/**
 * Chunk metadata with file and line information.
 */
export interface ChunkLocation {
	filepath: string;
	startLine?: number;
	endLine?: number;
}

// ============================================================================
// Line Range Overlap (RepoEval)
// ============================================================================

/**
 * Check if two line ranges overlap.
 *
 * Used by RepoEval to determine if a retrieved chunk contains the ground-truth
 * code location.
 *
 * @param chunk - Retrieved chunk's line span (must have startLine and endLine)
 * @param target - Ground-truth line span
 * @returns true if the ranges overlap (any shared line)
 */
export function lineRangeOverlaps(
	chunk: LineSpan,
	target: LineSpan,
): boolean {
	// Overlaps if chunk ends after target starts AND chunk starts before target ends
	return chunk.endLine >= target.startLine && chunk.startLine <= target.endLine;
}

/**
 * Compute Intersection over Union (IoU) for two line ranges.
 *
 * Useful for graded relevance scoring (e.g., partial credit for partial overlap).
 *
 * @param chunk - Retrieved chunk's line span
 * @param target - Ground-truth line span
 * @returns IoU value between 0 and 1
 */
export function lineRangeIoU(
	chunk: LineSpan,
	target: LineSpan,
): number {
	const intersectionStart = Math.max(chunk.startLine, target.startLine);
	const intersectionEnd = Math.min(chunk.endLine, target.endLine);

	if (intersectionStart > intersectionEnd) {
		return 0; // No overlap
	}

	const intersection = intersectionEnd - intersectionStart + 1;
	const chunkSize = chunk.endLine - chunk.startLine + 1;
	const targetSize = target.endLine - target.startLine + 1;
	const union = chunkSize + targetSize - intersection;

	return union > 0 ? intersection / union : 0;
}

/**
 * Options for location relevance checking.
 */
export interface LocationRelevanceOptions {
	/**
	 * Minimum IoU (Intersection over Union) threshold for relevance.
	 * 
	 * - 0.0: Any overlap counts as relevant (current default behavior)
	 * - 0.3: Weak alignment required (~30% overlap)
	 * - 0.5: Moderate alignment required (recommended for chunking evaluation)
	 * - 0.7: Strong alignment required (strict chunking evaluation)
	 * - 1.0: Exact match required (unrealistic for most chunkers)
	 * 
	 * Example with IoU threshold 0.5:
	 *   Chunk: lines 0-61 (62 lines), Target: lines 0-19 (20 lines)
	 *   Intersection: 20 lines, Union: 62 lines
	 *   IoU = 20/62 = 0.32 → NOT relevant (0.32 < 0.5)
	 * 
	 * Default: 0.0 (binary overlap, backward compatible)
	 */
	iouThreshold?: number;
}

/**
 * Check if a chunk is relevant to a target location (file + line range).
 *
 * For RepoEval-style benchmarks where ground truth is a specific code location.
 *
 * @param chunkLocation - Retrieved chunk's location metadata
 * @param targetFile - Ground-truth file path
 * @param targetSpan - Ground-truth line span (optional; if omitted, file match is sufficient)
 * @param options - Relevance options (e.g., IoU threshold)
 * @returns true if relevant
 */
export function isLocationRelevant(
	chunkLocation: ChunkLocation,
	targetFile: string,
	targetSpan?: LineSpan,
	options?: LocationRelevanceOptions,
): boolean {
	// Normalize file paths for comparison
	const normalizedChunk = normalizePath(chunkLocation.filepath);
	const normalizedTarget = normalizePath(targetFile);

	// File must match (either exact or suffix match for repo-relative paths)
	if (!pathMatches(normalizedChunk, normalizedTarget)) {
		return false;
	}

	// If no line span provided, file match is sufficient
	if (!targetSpan) {
		return true;
	}

	// If chunk has line info, check overlap/IoU
	if (chunkLocation.startLine !== undefined && chunkLocation.endLine !== undefined) {
		const chunkSpan = { startLine: chunkLocation.startLine, endLine: chunkLocation.endLine };
		
		// Use IoU threshold if specified, otherwise use binary overlap
		const iouThreshold = options?.iouThreshold ?? 0;
		
		if (iouThreshold > 0) {
			// IoU-based relevance: chunk must have sufficient overlap quality
			const iou = lineRangeIoU(chunkSpan, targetSpan);
			return iou >= iouThreshold;
		} else {
			// Binary overlap: any overlap counts
			return lineRangeOverlaps(chunkSpan, targetSpan);
		}
	}

	// Chunk doesn't have line info but file matches - count as relevant
	// (conservative approach for file-level chunkers)
	return true;
}

// ============================================================================
// Jaccard Similarity (RepoBench-R)
// ============================================================================

/**
 * Compute Jaccard similarity between two text strings.
 *
 * Uses token-based comparison (whitespace-split tokens).
 *
 * @param a - First text
 * @param b - Second text
 * @returns Jaccard similarity between 0 and 1
 */
export function jaccardSimilarity(a: string, b: string): number {
	const tokensA = tokenize(a);
	const tokensB = tokenize(b);

	if (tokensA.length === 0 && tokensB.length === 0) {
		return 1.0; // Both empty = identical
	}
	if (tokensA.length === 0 || tokensB.length === 0) {
		return 0; // One empty = no similarity
	}

	const setA = new Set(tokensA);
	const setB = new Set(tokensB);

	let intersection = 0;
	for (const token of setA) {
		if (setB.has(token)) {
			intersection++;
		}
	}

	const union = setA.size + setB.size - intersection;
	return union > 0 ? intersection / union : 0;
}

/**
 * Check if a chunk matches a gold snippet via Jaccard similarity.
 *
 * Used by RepoBench-R for content-based matching when chunk boundaries
 * differ from the original dataset's pre-chunked snippets.
 *
 * @param chunkContent - Retrieved chunk's content
 * @param goldContent - Gold snippet's content
 * @param threshold - Minimum Jaccard similarity to count as match (default: 0.7)
 * @returns true if Jaccard similarity ≥ threshold
 */
export function isJaccardMatch(
	chunkContent: string,
	goldContent: string,
	threshold = 0.7,
): boolean {
	return jaccardSimilarity(chunkContent, goldContent) >= threshold;
}

// ============================================================================
// File Match (SWE-bench Lite)
// ============================================================================

/**
 * Check if a chunk's file is in the list of modified files.
 *
 * Used by SWE-bench Lite where ground truth is the set of files modified
 * by a patch.
 *
 * @param chunkFile - Retrieved chunk's file path
 * @param modifiedFiles - List of file paths modified by the patch
 * @returns true if the chunk's file is in the modified list
 */
export function fileMatches(
	chunkFile: string,
	modifiedFiles: string[],
): boolean {
	const normalizedChunk = normalizePath(chunkFile);
	return modifiedFiles.some((modifiedFile) =>
		pathMatches(normalizedChunk, normalizePath(modifiedFile)),
	);
}

/**
 * Check if a chunk is relevant to a SWE-bench task.
 *
 * @param chunkLocation - Retrieved chunk's location metadata
 * @param modifiedFiles - Files modified by the patch
 * @param modifiedLineRanges - Optional: line ranges modified per file
 * @returns true if relevant
 */
export function isSWEBenchRelevant(
	chunkLocation: ChunkLocation,
	modifiedFiles: string[],
	modifiedLineRanges?: Map<string, LineSpan[]>,
): boolean {
	// First check file match
	if (!fileMatches(chunkLocation.filepath, modifiedFiles)) {
		return false;
	}

	// If no line ranges provided, file match is sufficient
	if (!modifiedLineRanges) {
		return true;
	}

	// If chunk has line info, check if it overlaps any modified range
	if (chunkLocation.startLine !== undefined && chunkLocation.endLine !== undefined) {
		const normalizedChunk = normalizePath(chunkLocation.filepath);
		const ranges = modifiedLineRanges.get(normalizedChunk);
		if (ranges && ranges.length > 0) {
			const chunkSpan = { startLine: chunkLocation.startLine, endLine: chunkLocation.endLine };
			return ranges.some((range) => lineRangeOverlaps(chunkSpan, range));
		}
	}

	// File matches but no line info or no modified ranges - count as relevant
	return true;
}

// ============================================================================
// Cross-File Coverage (CrossCodeEval)
// ============================================================================

/**
 * Compute coverage of ground-truth files by retrieved chunks.
 *
 * Used by CrossCodeEval to measure how many dependency files are retrieved.
 *
 * @param retrievedFiles - Set of file paths from retrieved chunks
 * @param groundTruthFiles - Set of ground-truth dependency file paths
 * @returns Coverage ratio between 0 and 1
 */
export function crossFileCoverage(
	retrievedFiles: string[],
	groundTruthFiles: string[],
): number {
	if (groundTruthFiles.length === 0) {
		return 1.0; // No dependencies to cover = perfect coverage
	}

	const normalizedRetrieved = new Set(retrievedFiles.map(normalizePath));
	let covered = 0;

	for (const gtFile of groundTruthFiles) {
		const normalizedGT = normalizePath(gtFile);
		// Check if any retrieved file matches this ground truth file
		if (
			normalizedRetrieved.has(normalizedGT) ||
			Array.from(normalizedRetrieved).some((r) => pathMatches(r, normalizedGT))
		) {
			covered++;
		}
	}

	return covered / groundTruthFiles.length;
}

/**
 * Check if a chunk is relevant for CrossCodeEval.
 *
 * @param chunkFile - Retrieved chunk's file path
 * @param dependencyFiles - Ground-truth dependency file paths
 * @returns true if the chunk's file is a required dependency
 */
export function isCrossCodeRelevant(
	chunkFile: string,
	dependencyFiles: string[],
): boolean {
	return fileMatches(chunkFile, dependencyFiles);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Normalize a file path for comparison.
 * - Converts backslashes to forward slashes
 * - Removes leading slashes
 * - Lowercases for case-insensitive comparison
 */
export function normalizePath(path: string): string {
	return path
		.replace(/\\/g, "/")
		.replace(/^\/+/, "")
		.toLowerCase();
}

/**
 * Check if two normalized paths match.
 * Supports suffix matching for repo-relative paths.
 */
export function pathMatches(path1: string, path2: string): boolean {
	// Exact match
	if (path1 === path2) {
		return true;
	}

	// Suffix match (one path may be absolute, the other relative)
	// Must match after a path separator to avoid "oauth.py" matching "auth.py"
	if (path1.endsWith(path2)) {
		const prefixEnd = path1.length - path2.length;
		// Valid if path2 is the entire path1, or preceded by a separator
		if (prefixEnd === 0 || path1[prefixEnd - 1] === "/") {
			return true;
		}
	}
	if (path2.endsWith(path1)) {
		const prefixEnd = path2.length - path1.length;
		if (prefixEnd === 0 || path2[prefixEnd - 1] === "/") {
			return true;
		}
	}

	return false;
}

/**
 * Tokenize text for Jaccard similarity.
 * Simple whitespace tokenization with normalization.
 */
function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/\s+/)
		.map((t) => t.replace(/[^\w]/g, ""))
		.filter((t) => t.length > 0);
}
