#!/usr/bin/env python3
"""
LangChain RecursiveCharacterTextSplitter Python Bridge for memorybench-bench-code-chunk.

This script provides a subprocess interface to LangChain's language-aware text splitter.
Uses the `from_language()` factory method for language-specific separators.

Usage:
    python langchain_bridge.py <filepath> [chunk_size] [overlap]

    filepath: Path to the file (used for language detection)
    chunk_size: Maximum chunk size in characters (default: 1500)
    overlap: Overlap in characters (default: 100)

Code is read from stdin. Output is JSON array of chunks.

Install dependencies:
    pip install langchain-text-splitters
"""

import json
import sys
from typing import Any, Optional


def get_language_enum(filepath: str) -> Optional["Language"]:
    """Get LangChain Language enum from filepath.

    Returns None for unsupported languages (falls back to generic splitter).
    """
    from langchain_text_splitters import Language

    ext = filepath.rsplit(".", 1)[-1].lower() if "." in filepath else ""

    # Only include languages confirmed to have separators defined
    # Note: Language.C and Language.CPP may not work (see langchain issue #22430)
    lang_map = {
        "py": Language.PYTHON,
        "js": Language.JS,
        "ts": Language.TS,
        "java": Language.JAVA,
        "go": Language.GO,
        "rb": Language.RUBY,
        "php": Language.PHP,
        "scala": Language.SCALA,
        "md": Language.MARKDOWN,
        "html": Language.HTML,
        "rst": Language.RST,
        "latex": Language.LATEX,
        "tex": Language.LATEX,
    }
    return lang_map.get(ext)  # Returns None for unsupported extensions


def chunk_with_langchain(
    code: str, filepath: str, chunk_size: int, overlap: int
) -> list[dict[str, Any]]:
    """Chunk using LangChain RecursiveCharacterTextSplitter with add_start_index=True."""
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    language = get_language_enum(filepath)

    if language is not None:
        splitter = RecursiveCharacterTextSplitter.from_language(
            language=language,
            chunk_size=chunk_size,
            chunk_overlap=overlap,
            add_start_index=True,  # Critical: returns start index in metadata
        )
    else:
        # Fallback to generic recursive splitter for unsupported languages
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=overlap,
            add_start_index=True,
        )

    # Use create_documents to get metadata with start_index
    docs = splitter.create_documents([code])

    results = []
    for doc in docs:
        start_idx = doc.metadata.get("start_index", 0)
        end_idx = start_idx + len(doc.page_content)

        # Convert character offsets to line numbers (1-indexed)
        start_line = code[:start_idx].count("\n") + 1
        end_line = code[:end_idx].count("\n") + 1

        results.append({
            "id": f"{filepath}:{start_line}-{end_line}",
            "text": doc.page_content,
            "startLine": start_line,
            "endLine": end_line,
        })

    return results


def main():
    if len(sys.argv) < 2:
        print(
            "Usage: langchain_bridge.py <filepath> [chunk_size] [overlap]",
            file=sys.stderr,
        )
        print("  Code is read from stdin", file=sys.stderr)
        sys.exit(1)

    filepath = sys.argv[1]
    chunk_size = int(sys.argv[2]) if len(sys.argv) > 2 else 1500
    overlap = int(sys.argv[3]) if len(sys.argv) > 3 else 100

    # Read code from stdin
    code = sys.stdin.read()

    try:
        results = chunk_with_langchain(code, filepath, chunk_size, overlap)
        print(json.dumps(results))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
