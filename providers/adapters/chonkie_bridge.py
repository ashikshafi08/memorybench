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
        language=language,
        tokenizer="character",  # Use character count
        chunk_size=chunk_size,
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
    """Chunk using Chonkie's RecursiveChunker (character-based fallback).
    
    Note: RecursiveChunker doesn't support overlap directly.
    Overlap would need OverlapRefinery post-processing.
    """
    from chonkie import RecursiveChunker

    chunker = RecursiveChunker(
        tokenizer="character",  # Use character count
        chunk_size=chunk_size,
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


def chunk_with_semantic_chunker(
    code: str, filepath: str, chunk_size: int
) -> list[dict[str, Any]]:
    """Chunk using Chonkie's SemanticChunker (embedding-based boundaries)."""
    from chonkie import SemanticChunker

    chunker = SemanticChunker(
        chunk_size=chunk_size,
        similarity_threshold=0.5,
    )

    chunks = chunker.chunk(code)

    results = []
    for chunk in chunks:
        start_line = code[: chunk.start_index].count("\n") + 1
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


def chunk_with_token_chunker(
    code: str, filepath: str, chunk_size: int, overlap: int
) -> list[dict[str, Any]]:
    """Chunk using Chonkie's TokenChunker (token-count based)."""
    from chonkie import TokenChunker

    chunker = TokenChunker(
        tokenizer="character",  # Use character count for consistency with other chunkers
        chunk_size=chunk_size,
        chunk_overlap=overlap,
    )

    chunks = chunker.chunk(code)

    results = []
    for chunk in chunks:
        start_line = code[: chunk.start_index].count("\n") + 1
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


def chunk_with_sentence_chunker(
    code: str, filepath: str, chunk_size: int
) -> list[dict[str, Any]]:
    """Chunk using Chonkie's SentenceChunker (sentence-boundary based)."""
    from chonkie import SentenceChunker

    chunker = SentenceChunker(
        tokenizer="character",  # Use character count
        chunk_size=chunk_size,
        min_sentences_per_chunk=1,
    )

    chunks = chunker.chunk(code)

    results = []
    for chunk in chunks:
        start_line = code[: chunk.start_index].count("\n") + 1
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
        print("  chunker_type: 'code', 'recursive', 'semantic', 'token', or 'sentence'", file=sys.stderr)
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
        elif chunker_type == "semantic":
            results = chunk_with_semantic_chunker(code, filepath, chunk_size)
        elif chunker_type == "token":
            results = chunk_with_token_chunker(code, filepath, chunk_size, overlap)
        elif chunker_type == "sentence":
            results = chunk_with_sentence_chunker(code, filepath, chunk_size)
        else:
            print(
                json.dumps({"error": f"Unknown chunker type: {chunker_type}. Supported: code, recursive, semantic, token, sentence"}),
                file=sys.stderr,
            )
            sys.exit(1)

        print(json.dumps(results))

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
