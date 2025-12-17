/**
 * Local file data loader for JSON/JSONL/CSV formats.
 */

import type { RawDataItem } from "./index.ts";

/**
 * Load data from a local JSON file.
 */
export async function loadLocalJson(path: string): Promise<RawDataItem[]> {
	const file = Bun.file(path);

	if (!(await file.exists())) {
		throw new Error(`Local data file not found: ${path}`);
	}

	const content = await file.text();
	const data = JSON.parse(content);

	if (!Array.isArray(data)) {
		throw new Error(`Expected array in JSON file, got ${typeof data}: ${path}`);
	}

	return data as RawDataItem[];
}

/**
 * Load data from a local JSONL file (one JSON object per line).
 */
export async function loadLocalJsonl(path: string): Promise<RawDataItem[]> {
	const file = Bun.file(path);

	if (!(await file.exists())) {
		throw new Error(`Local data file not found: ${path}`);
	}

	const content = await file.text();
	const lines = content.split("\n").filter((line) => line.trim());

	return lines.map((line, index) => {
		try {
			return JSON.parse(line) as RawDataItem;
		} catch (error) {
			throw new Error(
				`Failed to parse JSONL line ${index + 1} in ${path}: ${error}`,
			);
		}
	});
}

/**
 * Load data from a local CSV file.
 * Simple CSV parser - for complex CSVs, consider using a library.
 */
export async function loadLocalCsv(path: string): Promise<RawDataItem[]> {
	const file = Bun.file(path);

	if (!(await file.exists())) {
		throw new Error(`Local data file not found: ${path}`);
	}

	const content = await file.text();
	const lines = content.split("\n").filter((line) => line.trim());

	if (lines.length < 2) {
		return [];
	}

	const headers = parseCsvLine(lines[0]!);
	const data: RawDataItem[] = [];

	for (let i = 1; i < lines.length; i++) {
		const values = parseCsvLine(lines[i]!);
		const item: RawDataItem = {};

		for (let j = 0; j < headers.length; j++) {
			item[headers[j]!] = values[j] ?? "";
		}

		data.push(item);
	}

	return data;
}

/**
 * Parse a single CSV line, handling quoted values.
 */
function parseCsvLine(line: string): string[] {
	const values: string[] = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const char = line[i];

		if (char === '"') {
			if (inQuotes && line[i + 1] === '"') {
				// Escaped quote
				current += '"';
				i++;
			} else {
				inQuotes = !inQuotes;
			}
		} else if (char === "," && !inQuotes) {
			values.push(current.trim());
			current = "";
		} else {
			current += char;
		}
	}

	values.push(current.trim());
	return values;
}

/**
 * Load data from a local file based on format.
 */
export async function loadLocalData(
	path: string,
	format: "json" | "jsonl" | "csv" = "json",
): Promise<RawDataItem[]> {
	switch (format) {
		case "json":
			return loadLocalJson(path);
		case "jsonl":
			return loadLocalJsonl(path);
		case "csv":
			return loadLocalCsv(path);
		default:
			throw new Error(`Unsupported data format: ${format}`);
	}
}

