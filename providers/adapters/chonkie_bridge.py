#!/usr/bin/env python3
"""
Chonkie Python Bridge for memorybench-bench-code-chunk.

This script provides a subprocess interface to Chonkie chunkers.
Supports both CodeChunker (semantic) and RecursiveChunker (character fallback).

Usage:
    python chonkie_bridge.py <chunker_type> <filepath> <chunk_size> [<overlap>]
    
    chunker_type: "code" or "recursive"
    filepath: Path to the file (used for language detection)
    chunk_size: Maximum chunk size in characters
    overlap: Overlap in characters (only for recursive, default: 0)
    
Code is read from stdin. Output is JSON array of chunks.

Install dependencies:
    uv pip install chonkie tree-sitter-language-pack
"""

import json
import sys
from typing import Any


def get_language_from_filepath(filepath: str) -> str:
    """Determine programming language from file extension."""
    ext = filepath.rsplit(".", 1)[-1].lower() if "." in filepath else ""
    lang_map = {
        "py": "python",
        "js": "javascript",
        "ts": "typescript",
        "tsx": "tsx",
        "jsx": "javascript",
        "rs": "rust",
        "go": "go",
        "java": "java",
        "c": "c",
        "cpp": "cpp",
        "h": "c",
        "hpp": "cpp",
        "rb": "ruby",
        "php": "php",
        "cs": "c_sharp",
        "swift": "swift",
        "kt": "kotlin",
        "scala": "scala",
    }
    return lang_map.get(ext, "python")


def chunk_with_code_chunker(
    code: str, filepath: str, chunk_size: int
) -> list[dict[str, Any]]:
    """Chunk using Chonkie's CodeChunker (tree-sitter semantic chunking)."""
    from chonkie import CodeChunker

    language = get_language_from_filepath(filepath)

    chunker = CodeChunker(
        tokenizer_or_token_counter=lambda x: len(x),  # Character count
        chunk_size=chunk_size,
        language=language,
        include_nodes=False,
    )

    chunks = chunker.chunk(code)

    results = []
    for chunk in chunks:
        # Calculate line numbers from character indices
        start_line = code[: chunk.start_index].count("\n") + 1  # 1-indexed
        end_line = code[: chunk.end_index].count("\n") + 1

        results.append(
            {
                "id": f"{filepath}:{start_line}-{end_line}",
                "text": chunk.text,
                "startLine": start_line,
                "endLine": end_line,
            }
        )

    return results


def chunk_with_recursive_chunker(
    code: str, filepath: str, chunk_size: int, overlap: int
) -> list[dict[str, Any]]:
    """Chunk using Chonkie's RecursiveChunker (character-based fallback)."""
    from chonkie import RecursiveChunker

    chunker = RecursiveChunker(
        tokenizer_or_token_counter=lambda x: len(x),  # Character count
        chunk_size=chunk_size,
        chunk_overlap=overlap,
    )

    chunks = chunker.chunk(code)

    results = []
    for chunk in chunks:
        # Calculate line numbers from character indices
        start_line = code[: chunk.start_index].count("\n") + 1  # 1-indexed
        end_line = code[: chunk.end_index].count("\n") + 1

        results.append(
            {
                "id": f"{filepath}:{start_line}-{end_line}",
                "text": chunk.text,
                "startLine": start_line,
                "endLine": end_line,
            }
        )

    return results


def main():
    if len(sys.argv) < 4:
        print(
            "Usage: chonkie_bridge.py <chunker_type> <filepath> <chunk_size> [<overlap>]",
            file=sys.stderr,
        )
        print("  chunker_type: 'code' or 'recursive'", file=sys.stderr)
        print("  Code is read from stdin", file=sys.stderr)
        sys.exit(1)

    chunker_type = sys.argv[1]
    filepath = sys.argv[2]
    chunk_size = int(sys.argv[3])
    overlap = int(sys.argv[4]) if len(sys.argv) > 4 else 0

    # Read code from stdin
    code = sys.stdin.read()

    try:
        if chunker_type == "code":
            results = chunk_with_code_chunker(code, filepath, chunk_size)
        elif chunker_type == "recursive":
            results = chunk_with_recursive_chunker(code, filepath, chunk_size, overlap)
        else:
            print(
                json.dumps({"error": f"Unknown chunker type: {chunker_type}"}),
                file=sys.stderr,
            )
            sys.exit(1)

        print(json.dumps(results))

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
