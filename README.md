# Superbench

A unified benchmarking platform for evaluating memory providers, RAG systems, and context management solutions. Inspired by MTEB and SWE-bench, Superbench enables fair, reproducible comparisons across different memory architectures.

## Overview

Superbench is designed to answer the question: **"How well does this system use context to provide correct answers?"**

Unlike traditional retrieval benchmarks that measure recall/precision, Superbench focuses on **end-to-end correctness** and **memory-enabled success** - metrics that matter for production memory systems.

### Key Features

- 🎯 **Memory-focused metrics**: Accuracy, Success@K, F1 (not just recall/precision)
- 🔌 **Pluggable providers**: Easy to add new memory/RAG providers
- 📊 **Multiple benchmarks**: RAG template, LongMemEval, LoCoMo support
- 🤖 **LLM-as-a-Judge**: Automated evaluation using language models
- 📈 **Performance tracking**: Latency, token usage, cost metrics
- 🔄 **Resumable runs**: Checkpointing for long evaluations
- 📋 **Clean CLI**: Table-formatted results, export to JSON/CSV

## Quick Start

### Installation

```bash
# Install dependencies
bun install

# Link the CLI globally
bun link
```

### Setup

1. Copy the environment template:
```bash
cp .env.example .env
```

2. Add your API keys to `.env`:
   - `OPENROUTER_API_KEY` - Required for LLM evaluation (OpenRouter)
   - `ANTHROPIC_API_KEY` - Optional (for direct Anthropic access)
   - `VOYAGE_API_KEY` - Required for AQRAG embeddings
   - `DATABASE_URL` - PostgreSQL connection string (for PostgreSQL-based providers)
   - `GOOGLE_GENERATIVE_AI_API_KEY` - For Google embeddings (ContextualRetrieval)

### Running Your First Evaluation

Run the RAG template benchmark against AQRAG:

```bash
superbench eval --benchmarks rag-template --providers aqrag --metrics accuracy f1 success_at_5 --limit 10
```

This will:
1. Load 10 questions from the RAG template benchmark
2. Ingest document contexts into the AQRAG provider
3. Search for relevant information for each question
4. Generate answers using the LLM
5. Evaluate correctness using an LLM judge
6. Compute metrics (accuracy, F1, Success@K)
7. Display results in a clean table
8. Save results to SQLite database

### View Results

```bash
# List recent runs
superbench results

# View specific run
superbench results <runId>

# Export to JSON
superbench export <runId> --format json -o results.json
```

## Available Providers

### Code Chunking Providers (Production)

| Provider | Type | Description |
|----------|------|-------------|
| **code-chunk-ast** | Local | AST-based semantic chunking for code |
| **code-chunk-fixed** | Local | Fixed-size chunking for code |
| **chonkie-code** | Local | Python-based code chunking (requires Python 3.10+) |
| **chonkie-recursive** | Local | Recursive text chunking via Python |
| **langchain-code** | Local | LangChain-based code splitter |
| **llamaindex-code** | Local | LlamaIndex-based code splitter |
| **full-context-session** | Local | Full context per session (no chunking) |
| **full-context-turn** | Local | Full context per conversation turn |

### Experimental Providers (Coming Soon)

These memory providers are planned but not yet fully implemented:

| Provider | Type | Status |
|----------|------|--------|
| **AQRAG** | Local | Needs PostgreSQL + adapter implementation |
| **ContextualRetrieval** | Local | Needs adapter implementation |
| **Mem0** | Hosted | API integration planned |
| **Supermemory** | Hosted | API integration planned |
| **Zep** | Hosted | API integration planned |

## Available Benchmarks

| Benchmark | Description | Metrics |
|-----------|-------------|---------|
| **rag-template** | General-purpose RAG evaluation (10 questions) | accuracy, f1, success_at_5 |
| **longmemeval** | Multi-session long-term memory evaluation | accuracy_by_question_type, recall_at_5 |
| **locomo** | Long-form conversation memory | accuracy_by_category, bleu_1, rouge_l |

## Metrics Explained

### Primary Metrics

- **Accuracy**: Binary correctness (did the LLM judge mark it as correct?)
- **Success@K**: End-to-end success = correct answer AND relevant context in top-K
- **F1**: Token-level overlap between generated and expected answers (0-1)

### Why These Metrics?

Memory benchmarks answer: *"Did access to context change behavior correctly?"* - not *"Was the gold passage retrieved?"*

- ✅ **Accuracy** = End-to-end correctness (what users care about)
- ✅ **Success@K** = Verifies retrieval-to-answer pipeline worked
- ✅ **F1** = Captures partial recall and degradation
- ❌ **Recall@K/MRR** = Not primary metrics (assume gold passages, lexical matching)

See [METRICS_AND_ORCHESTRATION.md](./METRICS_AND_ORCHESTRATION.md) for detailed metric definitions.

## CLI Commands

### List Providers and Benchmarks

```bash
superbench list
```

### Run Evaluation

```bash
# Single provider, single benchmark
superbench eval --benchmarks rag-template --providers aqrag --limit 10

# Multiple providers (comparison)
superbench eval --benchmarks rag-template --providers aqrag contextual-retrieval openrouter-rag

# Custom metrics
superbench eval --benchmarks rag-template --providers aqrag --metrics accuracy f1 success_at_5 bleu_1

# With filtering
superbench eval --benchmarks rag-template --providers aqrag --limit 5 --start 0
```

### View and Export Results

```bash
# List recent runs
superbench results

# View specific run with metrics
superbench results <runId> --metrics accuracy f1

# Export to JSON
superbench export <runId> --format json -o results.json

# Export to CSV
superbench export <runId> --format csv -o results.csv
```

## Architecture

```
superbench/
├── core/               # Core evaluation engine
│   ├── metrics/       # Pluggable metric registry
│   ├── runner.ts      # Benchmark runner with checkpointing
│   └── results.ts     # SQLite results storage
├── providers/         # Provider implementations
│   ├── adapters/      # Provider adapters
│   ├── configs/       # Provider YAML configs
│   └── */             # Provider-specific code
├── benchmarks/        # Benchmark definitions
│   ├── configs/       # Benchmark YAML configs
│   ├── loaders/       # Data loaders
│   └── evaluators/    # Evaluation methods (LLM judge, exact-match)
└── cli/               # Command-line interface
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed architecture documentation.

## Adding a New Provider

1. Create provider directory: `providers/YourProvider/`
2. Implement provider interface (see `providers/base/types.ts`)
3. Create adapter: `providers/adapters/your-provider.ts`
4. Add config: `providers/configs/your-provider.yaml`
5. Register in factory: `providers/factory.ts`

See [PROVIDER_CUSTOMIZATION_GUIDE.md](./PROVIDER_CUSTOMIZATION_GUIDE.md) for details.

## Adding a New Benchmark

1. Create benchmark data file (JSON/CSV)
2. Create config: `benchmarks/configs/your-benchmark.yaml`
3. Define schema mapping (itemId, question, answer, context)
4. Specify evaluation method (llm-judge, exact-match, etc.)
5. Set default metrics

## Development

```bash
# Run tests (if available)
bun test

# Type check
bun run typecheck

# Lint
bun run lint
```

## License

[Your License Here]

## Contributing

Contributions welcome! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## References

- **LongMemEval**: Multi-session long-term memory evaluation
- **LoCoMo**: Long-form Conversation Memory benchmark
- **MTEB**: Massive Text Embedding Benchmark (inspiration)
- **SWE-bench**: Software Engineering Benchmark (inspiration)
