#!/usr/bin/env python3
"""
LlamaIndex CodeSplitter Python Bridge for superbench-bench-code-chunk.

This script provides a subprocess interface to LlamaIndex's CodeSplitter.
Uses tree-sitter parsing for semantic code chunking.

Usage:
    python llamaindex_bridge.py <filepath> <chunk_size>

    filepath: Path to the file (used for language detection)
    chunk_size: Maximum chunk size in characters

Code is read from stdin. Output is JSON array of chunks.

Install dependencies:
    pip install llama-index-core
    # Tree-sitter parsers are included with llama-index
"""

import json
import sys
from typing import Any


def get_language(filepath: str) -> str:
    """Determine programming language from file extension.

    Returns language name as expected by LlamaIndex CodeSplitter.
    """
    ext = filepath.rsplit(".", 1)[-1].lower() if "." in filepath else ""

    # Map extensions to LlamaIndex supported languages
    # See: https://docs.llamaindex.ai/en/stable/api_reference/node_parsers/code/
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
        "lua": "lua",
        "pl": "perl",
        "r": "r",
        "sh": "bash",
        "bash": "bash",
        "zsh": "bash",
        "ps1": "powershell",
        "sql": "sql",
        "md": "markdown",
        "html": "html",
        "css": "css",
        "json": "json",
        "yaml": "yaml",
        "yml": "yaml",
        "toml": "toml",
        "xml": "xml",
    }
    return lang_map.get(ext, "python")  # Default to Python


def chunk_with_llamaindex(code: str, filepath: str, chunk_size: int) -> list[dict[str, Any]]:
    """Chunk using LlamaIndex CodeSplitter."""
    from llama_index.core import Document
    from llama_index.core.node_parser import CodeSplitter

    language = get_language(filepath)

    splitter = CodeSplitter(
        language=language,
        max_chars=chunk_size,
    )

    doc = Document(text=code)
    nodes = splitter.get_nodes_from_documents([doc])

    results = []
    for node in nodes:
        # LlamaIndex provides start_char_idx in metadata
        start_idx = node.start_char_idx if node.start_char_idx is not None else 0
        end_idx = node.end_char_idx if node.end_char_idx is not None else len(node.text)

        # Convert character offsets to line numbers (1-indexed)
        start_line = code[:start_idx].count("\n") + 1
        end_line = code[:end_idx].count("\n") + 1

        results.append({
            "id": f"{filepath}:{start_line}-{end_line}",
            "text": node.text,
            "startLine": start_line,
            "endLine": end_line,
        })

    return results


def main():
    if len(sys.argv) < 3:
        print(
            "Usage: llamaindex_bridge.py <filepath> <chunk_size>",
            file=sys.stderr,
        )
        print("  Code is read from stdin", file=sys.stderr)
        sys.exit(1)

    filepath = sys.argv[1]
    chunk_size = int(sys.argv[2]) if len(sys.argv) > 2 else 1500

    # Read code from stdin
    code = sys.stdin.read()

    try:
        results = chunk_with_llamaindex(code, filepath, chunk_size)
        print(json.dumps(results))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
