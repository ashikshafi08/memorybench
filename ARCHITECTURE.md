# Memorybench Architecture Design

> A config-driven benchmarking platform for memory providers

## Overview

Memorybench is a unified benchmarking platform that makes it easy to:
- **Add providers**: Drop in a config file for any memory system (hosted APIs, local algorithms, or Docker-based services)
- **Add benchmarks**: Define schema mappings for any dataset
- **Run evaluations**: Compare providers across benchmarks with a single command
- **Track results**: Store, compare, and export evaluation results

## Design Principles

1. **Config over code**: 95% of providers/benchmarks should work with just YAML
2. **Convention over configuration**: Sensible defaults, override when needed
3. **Extensibility**: Custom code only for unique algorithms
4. **Resumability**: Checkpoint everything, resume from failures

---

## File Structure

```
memorybench/
├── providers/
│   ├── configs/                    # DROP-IN PROVIDER CONFIGS
│   │   ├── supermemory.yaml
│   │   ├── mem0.yaml
│   │   ├── letta.yaml
│   │   └── zep.yaml
│   ├── adapters/                   # CUSTOM CODE (only if needed)
│   │   ├── aqrag.ts               # Custom algorithm
│   │   └── contextual-retrieval.ts
│   └── base/
│       ├── http-provider.ts       # Generic HTTP adapter
│       ├── local-provider.ts      # For local RAG techniques
│       └── types.ts
├── benchmarks/
│   ├── configs/                    # DROP-IN BENCHMARK CONFIGS
│   │   ├── locomo.yaml
│   │   ├── longmemeval.yaml
│   │   └── nolima.yaml
│   ├── datasets/                   # Data files
│   │   ├── locomo10.json
│   │   └── longmemeval/
│   └── evaluators/                 # Custom evaluators (only if needed)
│       └── llm-judge.ts
├── core/
│   ├── registry.ts                # Auto-discovers configs
│   ├── runner.ts                  # Runs benchmarks
│   ├── results.ts                 # Stores results
│   └── metrics.ts                 # Calculates metrics
├── cli/
│   └── index.ts                   # CLI entry point
└── index.ts                       # Main entry
```

---

## Provider Configuration

### Overview

Providers are memory systems that can store and retrieve information. They come in three forms:

1. **Hosted APIs** (config-only): External services like Supermemory, Mem0, Letta, Zep
   - Just drop in a YAML config with endpoint mappings
   - No code required

2. **Local algorithms** (config + code): Custom implementations like AQRAG, ContextualRetrieval
   - TypeScript code that runs in-process
   - May use Docker for dependencies (Postgres, Redis, etc.)
   - Full control over chunking, embedding, retrieval logic

3. **Self-hosted services** (config + Docker): Containerized services exposing HTTP endpoints
   - Run in Docker with `docker-compose`
   - Expose HTTP API that memorybench calls
   - Good for testing production-like deployments locally

### Config Schema

```yaml
# Provider identity
name: string                    # Unique identifier (lowercase, no spaces)
displayName: string             # Human-readable name
description: string             # Brief description
type: hosted | local | docker   # How the provider runs

# For type: hosted (external API)
connection:
  baseUrl: string               # API base URL (supports env vars: ${VAR:-default})
  timeout: number               # Request timeout in ms (default: 30000)

# For type: local (in-process TypeScript)
adapter: string                 # Path to TypeScript adapter file

# For type: docker (self-hosted container)
docker:
  compose: string               # Path to docker-compose.yml
  service: string               # Service name in compose file
  healthcheck: string           # URL to check if service is ready
  baseUrl: string               # API URL once container is running

# Authentication (for hosted and docker types)
auth:
  type: bearer | token | apikey | none
  header: string                # Header name (default: "Authorization")
  prefix: string                # Optional prefix (e.g., "Bearer ", "Token ")
  envVar: string                # Environment variable for API key

# Scoping (how to isolate benchmark runs)
scoping:
  strategy: containerTags | userId | sessionId | custom
  runIdFormat: string           # Template: "${benchmarkId}-${runId}"

# API Endpoints
endpoints:
  add:
    method: POST | PUT
    path: string                # URL path
    body: object                # Request body template with JSONPath mappings

  search:
    method: GET | POST
    path: string
    body: object                # Request body/params template
    response:
      results: string           # JSONPath to results array
      contentField: string      # JSONPath to content in each result
      scoreField: string        # JSONPath to score in each result
      chunksField: string       # Optional: JSONPath to chunks

  clear:
    method: DELETE
    path: string                # Supports ${runTag} placeholder

# Provider capabilities
capabilities:
  supportsChunks: boolean       # Returns chunk-level results
  supportsBatch: boolean        # Supports batch add operations
  supportsMetadata: boolean     # Supports custom metadata
  supportsRerank: boolean       # Has reranking capability

# Rate limiting (prevents overwhelming APIs)
rateLimit:
  addDelayMs: number            # Delay between add operations (default: 0)
  searchDelayMs: number         # Delay between search operations (default: 0)
  batchDelayMs: number          # Delay between batches (default: 1000)
  maxRetries: number            # Retry count on failure (default: 3)
  retryDelayMs: number          # Delay before retry (default: 2000)
```

### Example: Supermemory

```yaml
name: supermemory
displayName: "Supermemory.ai"
description: "Production memory API from Supermemory"
type: hosted

connection:
  baseUrl: "${SUPERMEMORY_API_URL:-https://api.supermemory.ai/v3}"
  timeout: 30000

auth:
  type: bearer
  header: "Authorization"
  envVar: "SUPERMEMORY_API_KEY"

scoping:
  strategy: containerTags
  runIdFormat: "${benchmarkId}-${runId}"

endpoints:
  add:
    method: POST
    path: /documents
    body:
      content: "$.content"
      containerTags: ["$.runTag"]

  search:
    method: POST
    path: /search
    body:
      query: "$.query"
      containerTags: ["$.runTag"]
      limit: 10
      threshold: 0.3
      includeChunks: true
    response:
      results: "$.results"
      contentField: "$.memory"
      scoreField: "$.score"
      chunksField: "$.chunks"

  clear:
    method: DELETE
    path: /containers/${runTag}

capabilities:
  supportsChunks: true
  supportsBatch: false
  supportsMetadata: true
  supportsRerank: true

rateLimit:
  addDelayMs: 100
  searchDelayMs: 1000
  batchDelayMs: 10000
  maxRetries: 3
  retryDelayMs: 2000
```

### Example: Mem0

```yaml
name: mem0
displayName: "Mem0"
description: "Open source memory layer for AI"
type: hosted

connection:
  baseUrl: "${MEM0_API_URL:-https://api.mem0.ai/v1}"
  timeout: 30000

auth:
  type: token
  header: "Authorization"
  prefix: "Token "
  envVar: "MEM0_API_KEY"

scoping:
  strategy: userId
  runIdFormat: "bench-${benchmarkId}-${runId}"

endpoints:
  add:
    method: POST
    path: /memories/
    body:
      messages:
        - role: "user"
          content: "$.content"
      user_id: "$.userId"
      metadata: "$.metadata"

  search:
    method: POST
    path: /memories/search/
    body:
      query: "$.query"
      user_id: "$.userId"
      limit: 10
    response:
      results: "$.memories"
      contentField: "$.memory"
      scoreField: "$.score"

  clear:
    method: DELETE
    path: /memories/
    body:
      user_id: "$.userId"

capabilities:
  supportsChunks: false
  supportsBatch: true
  supportsMetadata: true
  supportsRerank: false
```

### Example: Local Provider (AQRAG)

```yaml
name: aqrag
displayName: "AQRAG"
description: "Anticipatory Question RAG - generates questions for better retrieval"
type: local
adapter: "./adapters/aqrag.ts"  # Custom implementation

# Local provider config
local:
  database:
    type: postgres
    connectionString: "${DATABASE_URL}"
    schema: "./adapters/aqrag/schema.sql"

  chunking:
    size: 1024          # tokens
    overlap: 96         # tokens
    strategy: fixed     # fixed | semantic | paragraph

  embedding:
    provider: google
    model: "gemini-embedding-001"
    dimensions: 1536

  enhancement:
    enabled: true
    model: "claude-3-5-haiku"
    generateQuestions: true
    questionsPerChunk: 10

  retrieval:
    strategy: weighted
    maxResults: 10
    weights:
      chunk: 0.5
      questions: 0.5

capabilities:
  supportsChunks: true
  supportsBatch: false
  supportsMetadata: true
  supportsRerank: false
```

### Example: Docker Provider (Chroma)

For self-hosted vector databases or services that run in containers:

```yaml
name: chroma
displayName: "Chroma (Self-hosted)"
description: "Open-source embedding database running locally"
type: docker

docker:
  compose: "./providers/chroma/docker-compose.yml"
  service: chroma
  healthcheck: "http://localhost:8000/api/v1/heartbeat"
  baseUrl: "http://localhost:8000"

# Once container is up, uses HTTP endpoints
endpoints:
  add:
    method: POST
    path: /api/v1/collections/${collectionId}/add
    body:
      ids: ["$.id"]
      documents: ["$.content"]
      metadatas: ["$.metadata"]

  search:
    method: POST
    path: /api/v1/collections/${collectionId}/query
    body:
      query_texts: ["$.query"]
      n_results: 10
    response:
      results: "$.documents[0]"
      contentField: "$"
      scoreField: "$.distances[0]"

capabilities:
  supportsChunks: false
  supportsBatch: true
  supportsMetadata: true
  supportsRerank: false
```

---

## Benchmark Configuration

### Overview

Benchmarks define:
- Where the data comes from
- How to parse it (schema mapping)
- How to evaluate results

### Config Schema

```yaml
# Benchmark identity
name: string                    # Unique identifier
displayName: string             # Human-readable name
description: string             # Brief description
version: string                 # Benchmark version
source: string                  # URL to original source
paper: string                   # URL to paper (if applicable)

# Data source
data:
  type: huggingface | local | url
  path: string                  # HF dataset ID, file path, or URL
  localPath: string             # Local cache path
  format: json | jsonl | csv

# Schema mapping
schema:
  itemId: string                # Field name for unique ID
  question: string              # Field name for question
  answer: string                # Field name for expected answer

  # Context to ingest
  context:
    field: string               # Field containing context
    type: array | object | string
    dateField: string           # Optional: field with dates
    itemSchema:                 # How to parse each context item
      content: string           # JSONPath to content
      role: string              # Optional: speaker/role

  # Metadata fields
  metadata:
    [key]: string               # Map friendly names to field paths

# Question types (if applicable)
questionTypes:
  - name: string
    evaluationPrompt: string    # Prompt template name
    allowOffByOne: boolean      # For temporal questions

# Ingestion strategy
ingestion:
  mode: bulk | incremental | session-based
  batchSize: number
  delayBetweenBatches: number   # ms
  preprocessing:
    escapeHtml: boolean
    removeFields: string[]
    formatTemplate: string      # Template for formatting content

# Search configuration
search:
  defaultLimit: number
  defaultThreshold: number
  includeChunks: boolean

# Evaluation
evaluation:
  method: exact-match | llm-judge | semantic-similarity | custom

  # Answering model configuration
  answeringModel:
    model: string               # Model to generate answers (e.g., "gpt-4o")
    temperature: number         # Default: 0
    
  # Answer prompt (how to ask the model to answer)
  answerPrompt:
    default: string             # Default prompt template for generating answers
    byQuestionType:             # Optional: per-question-type prompts
      [questionType]: string
    userOverride: boolean       # Allow users to override via CLI (default: true)

  # Judge configuration
  judge:
    model: string               # Model for evaluation (e.g., "gpt-4o")
    temperature: number         # Default: 0

  # Judge prompts (how to evaluate correctness)
  judgePrompts:
    source: string              # Where defaults come from: "paper" | "custom"
    paperReference: string      # Citation for default prompts
    default: string             # Default judge prompt
    byQuestionType:             # Per-question-type judge prompts (like LongMemEval)
      [questionType]: string
    userOverride: boolean       # Allow users to override via CLI (default: true)

  # For custom evaluation
  customEvaluator: string       # Path to evaluator script

# Metrics
metrics: string[]               # accuracy, recall_at_k, precision_at_k, etc.

# Runtime
runtime:
  checkpointing: boolean
  checkpointGranularity: item | batch | session
  resumable: boolean
```

### Example: LongMemEval

```yaml
name: longmemeval
displayName: "LongMemEval"
description: "Multi-session long-term memory evaluation"
version: "1.0"
source: "https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned"
paper: "https://arxiv.org/abs/2410.10813"

data:
  type: huggingface
  path: "xiaowu0162/longmemeval-cleaned"
  localPath: "./datasets/longmemeval_s_cleaned.json"
  format: json

schema:
  itemId: "question_id"
  question: "question"
  answer: "answer"

  context:
    field: "haystack_sessions"
    type: array
    dateField: "haystack_dates"
    itemSchema:
      content: "$.content"
      role: "$.role"

  metadata:
    questionType: "question_type"
    questionDate: "question_date"

questionTypes:
  - name: single-session-user
    evaluationPrompt: default
  - name: single-session-assistant
    evaluationPrompt: default
  - name: single-session-preference
    evaluationPrompt: rubric
  - name: knowledge-update
    evaluationPrompt: knowledge-update
  - name: temporal-reasoning
    evaluationPrompt: temporal
    allowOffByOne: true
  - name: multi-session
    evaluationPrompt: default

ingestion:
  mode: session-based
  batchSize: 1
  delayBetweenBatches: 10000
  preprocessing:
    escapeHtml: true
    formatTemplate: |
      Date: ${date}
      Session: ${JSON.stringify(session)}

search:
  defaultLimit: 10
  defaultThreshold: 0.3
  includeChunks: true

evaluation:
  method: llm-judge
  
  # Answering model - completely configurable
  answeringModel:
    model: "gpt-4o"              # Default, can be overridden via CLI
    temperature: 0
  
  # Answer prompt - fully configurable by users
  answerPrompt:
    default: |
      You are a question-answering system. Based on the retrieved context below, answer the question.
      
      Question: ${question}
      Question Date: ${questionDate}
      
      Retrieved Context:
      ${retrievedContext}
      
      Instructions:
      - Identify which parts of the context are relevant to answering the question
      - Consider temporal relationships, sequences of events, and any updates to information
      - If the context contains enough information, provide a clear, concise answer
      - If the context does not contain enough information, respond with "I don't know"
      - Base your answer ONLY on the provided context
      
      Answer:
    userOverride: true          # Users can override via --answer-prompt flag or file
  
  # Judge configuration
  judge:
    model: "gpt-4o"
    temperature: 0
  
  # Judge prompts - defaults from paper, user can override
  judgePrompts:
    source: "paper"
    paperReference: "LongMemEval (arXiv:2410.10813) Section 4.2, Figure 10"
    userOverride: true          # Users can override via --judge-prompt flag or file
    
    # Default judge prompt (used for most question types)
    default: |
      I will give you a question, a correct answer, and a response from a model.
      Please answer yes if the response contains the correct answer. Otherwise, answer no.
      If the response is equivalent to the correct answer or contains all the intermediate
      steps to get the correct answer, you should also answer yes.
      If the response only contains a subset of the information required, answer no.
    
    # Per-question-type judge prompts (from the paper)
    byQuestionType:
      temporal-reasoning: |
        I will give you a question, a correct answer, and a response from a model.
        Please answer yes if the response contains the correct answer. Otherwise, answer no.
        If the response is equivalent to the correct answer or contains all the intermediate
        steps to get the correct answer, you should also answer yes.
        If the response only contains a subset of the information required, answer no.
        In addition, do not penalize off-by-one errors for the number of days.
        If the question asks for days/weeks/months and the model makes off-by-one errors
        (e.g., predicting 19 days when the answer is 18), the response is still correct.
      
      knowledge-update: |
        I will give you a question, a correct answer, and a response from a model.
        Please answer yes if the response contains the correct answer. Otherwise, answer no.
        If the response contains some previous information along with an updated answer,
        the response should be considered correct as long as the updated answer is correct.
      
      single-session-preference: |
        I will give you a question, a rubric for desired personalized response, and a response.
        Please answer yes if the response satisfies the desired response. Otherwise, answer no.
        The model does not need to reflect all points in the rubric. The response is correct
        as long as it recalls and utilizes the user's personal information correctly.

metrics:
  - accuracy
  - accuracy_by_question_type

runtime:
  checkpointing: true
  checkpointGranularity: session
  resumable: true
```

### Example: LoCoMo

```yaml
name: locomo
displayName: "LoCoMo"
description: "Long-form Conversation Memory benchmark"
version: "1.0"
source: "https://github.com/snap-research/locomo"
paper: "https://arxiv.org/abs/2402.17753"

data:
  type: local
  path: "./datasets/locomo10.json"
  format: json

schema:
  itemId: "sample_id"

  # Questions are nested array
  questions:
    field: "qa"
    questionField: "question"
    answerField: "answer"
    evidenceField: "evidence"
    categoryField: "category"

  # Context is the conversation
  context:
    field: "conversation"
    type: object
    sessionPattern: "session_*"
    datePattern: "session_*_date_time"
    itemSchema:
      speaker: "$.speaker"
      text: "$.text"
      dialogId: "$.dia_id"

  metadata:
    speakerA: "speaker_a"
    speakerB: "speaker_b"

categories:
  1: "Factual Recall"
  2: "Temporal Reasoning"
  3: "Inference"

ingestion:
  mode: session-based
  batchSize: 1
  delayBetweenBatches: 5000
  preprocessing:
    formatTemplate: |
      ${sessionDate}
      ${session.map(turn => `${turn.speaker}: ${turn.text}`).join('\n')}

search:
  defaultLimit: 10
  defaultThreshold: 0.3
  includeChunks: true

evaluation:
  method: llm-judge

  # Answering model
  answeringModel:
    model: "gpt-4o"
    temperature: 0

  # Answer prompt - configurable
  answerPrompt:
    default: |
      Based on the conversation history, answer the question.
      Question: ${question}
      Context: ${retrievedContext}
      Provide a concise answer based only on the context.
    userOverride: true

  # Judge configuration
  judge:
    model: "gpt-4o"
    temperature: 0

  # Judge prompts - single prompt for whole benchmark (unlike LongMemEval)
  judgePrompts:
    source: "paper"
    paperReference: "LoCoMo (arXiv:2402.17753) Section 4"
    userOverride: true
    default: |
      Given the question and expected answer, evaluate if the response is correct.
      Consider the evidence references when determining correctness.
      Answer "yes" if correct, "no" otherwise.
    # No byQuestionType - LoCoMo uses same prompt for all categories

metrics:
  - accuracy
  - accuracy_by_category
  - recall_at_5
  - precision_at_5

runtime:
  checkpointing: true
  checkpointGranularity: item
  resumable: true
```

---

## CLI Interface

### Commands

```bash
# List available providers and benchmarks
memorybench list
memorybench list --providers
memorybench list --benchmarks
memorybench list --benchmarks --tags temporal

# Describe a specific benchmark/provider
memorybench describe longmemeval
memorybench describe supermemory

# Run evaluation
memorybench eval \
  --benchmarks longmemeval locomo \
  --providers supermemory mem0 \
  --limit 100 \
  --concurrency 10 \
  --output ./results

# Run with position ranges (for manual parallelism across machines)
memorybench eval \
  --benchmarks longmemeval \
  --providers supermemory \
  --start 1 --end 50          # Process questions 1-50 (1-indexed, inclusive)

# Run on second machine with remaining range
memorybench eval \
  --benchmarks longmemeval \
  --providers supermemory \
  --start 51 --end 100        # Process questions 51-100

# Filter by question type (for LongMemEval)
memorybench eval \
  --benchmarks longmemeval \
  --providers supermemory \
  --question-type temporal-reasoning

# Run with specific answering model
memorybench eval \
  --benchmarks longmemeval \
  --providers supermemory \
  --answering-model gpt-4o

# Override answer prompt (fully configurable)
memorybench eval \
  --benchmarks longmemeval \
  --providers supermemory \
  --answer-prompt ./my-answer-prompt.txt

# Override judge prompt (while keeping paper defaults as fallback)
memorybench eval \
  --benchmarks longmemeval \
  --providers supermemory \
  --judge-prompt ./my-judge-prompt.txt

# Use inline prompt override
memorybench eval \
  --benchmarks longmemeval \
  --providers supermemory \
  --judge-prompt "Answer yes if correct, no otherwise."

# Resume from checkpoint
memorybench eval --resume run_abc123

# View results
memorybench results run_abc123
memorybench results --compare supermemory mem0 --benchmark longmemeval

# Export results
memorybench export run_abc123 --format csv --output results.csv
memorybench export run_abc123 --format json --output results.json
```

### Output Format

```
╭─────────────────────────────────────────────────────────────────╮
│                    MEMORYBENCH EVALUATION                        │
├─────────────────────────────────────────────────────────────────┤
│ Run ID: run_abc123                                              │
│ Benchmarks: longmemeval, locomo                                 │
│ Providers: supermemory, mem0                                    │
│ Started: 2025-12-16 10:30:00                                    │
╰─────────────────────────────────────────────────────────────────╯

Evaluating longmemeval × supermemory...
  ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░ 50/100 (50%) | ETA: 2m 30s
  Current accuracy: 78.5%

╭──────────────────────────────────────────────────────────────────╮
│ RESULTS: longmemeval                                             │
├──────────────────────────────────────────────────────────────────┤
│ Provider      │ Accuracy │ By Question Type                      │
├───────────────┼──────────┼───────────────────────────────────────┤
│ supermemory   │  78.5%   │ temporal: 82%, multi-session: 71%    │
│ mem0          │  75.2%   │ temporal: 79%, multi-session: 68%    │
╰──────────────────────────────────────────────────────────────────╯

╭──────────────────────────────────────────────────────────────────╮
│ RESULTS: locomo                                                  │
├──────────────────────────────────────────────────────────────────┤
│ Provider      │ Accuracy │ By Category                           │
├───────────────┼──────────┼───────────────────────────────────────┤
│ supermemory   │  81.3%   │ factual: 85%, temporal: 78%          │
│ mem0          │  79.1%   │ factual: 82%, temporal: 75%          │
╰──────────────────────────────────────────────────────────────────╯

Results saved to: ./results/run_abc123/
```

---

## Core Components

### Registry

Auto-discovers providers and benchmarks from config directories.

```typescript
// core/registry.ts
import { glob } from 'glob';
import { parse } from 'yaml';
import { z } from 'zod';

const ProviderConfigSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  type: z.enum(['hosted', 'local']),
  // ... full schema
});

const BenchmarkConfigSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  // ... full schema
});

export class Registry {
  private providers = new Map<string, ProviderConfig>();
  private benchmarks = new Map<string, BenchmarkConfig>();

  async discover(): Promise<void> {
    // Load provider configs
    const providerFiles = await glob('providers/configs/*.yaml');
    for (const file of providerFiles) {
      const raw = parse(await Bun.file(file).text());
      const config = ProviderConfigSchema.parse(raw);
      this.providers.set(config.name, config);
    }

    // Load benchmark configs
    const benchmarkFiles = await glob('benchmarks/configs/*.yaml');
    for (const file of benchmarkFiles) {
      const raw = parse(await Bun.file(file).text());
      const config = BenchmarkConfigSchema.parse(raw);
      this.benchmarks.set(config.name, config);
    }
  }

  getProvider(name: string): ProviderConfig {
    const config = this.providers.get(name);
    if (!config) throw new Error(`Unknown provider: ${name}`);
    return config;
  }

  getBenchmark(name: string): BenchmarkConfig {
    const config = this.benchmarks.get(name);
    if (!config) throw new Error(`Unknown benchmark: ${name}`);
    return config;
  }

  listProviders(): ProviderConfig[] {
    return Array.from(this.providers.values());
  }

  listBenchmarks(): BenchmarkConfig[] {
    return Array.from(this.benchmarks.values());
  }
}
```

### HTTP Provider Adapter

Generic adapter for hosted API providers.

```typescript
// providers/base/http-provider.ts
import { JSONPath } from 'jsonpath-plus';

export class HttpProvider implements Provider {
  constructor(private config: ProviderConfig) {
    this.validateConfig();
  }

  async addContext(data: PreparedData, runTag: string): Promise<void> {
    const endpoint = this.config.endpoints.add;
    const body = this.mapBody(endpoint.body, { ...data, runTag });

    const response = await fetch(
      `${this.resolveBaseUrl()}${endpoint.path}`,
      {
        method: endpoint.method,
        headers: this.getHeaders(),
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      throw new Error(`Add failed: ${response.status} ${await response.text()}`);
    }
  }

  async searchQuery(query: string, runTag: string): Promise<SearchResult[]> {
    const endpoint = this.config.endpoints.search;
    const body = this.mapBody(endpoint.body, { query, runTag });

    const response = await fetch(
      `${this.resolveBaseUrl()}${endpoint.path}`,
      {
        method: endpoint.method,
        headers: this.getHeaders(),
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      throw new Error(`Search failed: ${response.status}`);
    }

    const json = await response.json();
    return this.mapResponse(endpoint.response, json);
  }

  async clear(runTag: string): Promise<void> {
    const endpoint = this.config.endpoints.clear;
    if (!endpoint) return;

    const path = endpoint.path.replace('${runTag}', runTag);

    await fetch(`${this.resolveBaseUrl()}${path}`, {
      method: endpoint.method,
      headers: this.getHeaders(),
    });
  }

  private resolveBaseUrl(): string {
    return this.config.connection.baseUrl.replace(
      /\$\{(\w+)(?::-([^}]*))?\}/g,
      (_, name, defaultValue) => process.env[name] || defaultValue || ''
    );
  }

  private getHeaders(): Headers {
    const headers = new Headers({
      'Content-Type': 'application/json',
    });

    const { auth } = this.config;
    if (auth.type !== 'none') {
      const apiKey = process.env[auth.envVar];
      if (!apiKey) {
        throw new Error(`Missing API key: ${auth.envVar}`);
      }
      headers.set(auth.header, `${auth.prefix || ''}${apiKey}`);
    }

    return headers;
  }

  private mapBody(template: object, data: object): object {
    return JSON.parse(
      JSON.stringify(template).replace(
        /"\$\.(\w+)"/g,
        (_, path) => JSON.stringify(JSONPath({ path: `$.${path}`, json: data })[0])
      )
    );
  }

  private mapResponse(responseConfig: object, json: object): SearchResult[] {
    const results = JSONPath({ path: responseConfig.results, json });

    return results.map((item: any) => ({
      id: item.id || '',
      content: JSONPath({ path: responseConfig.contentField, json: item })[0],
      score: JSONPath({ path: responseConfig.scoreField, json: item })[0] || 0,
      chunks: responseConfig.chunksField
        ? JSONPath({ path: responseConfig.chunksField, json: item })[0]
        : undefined,
    }));
  }
}
```

### Benchmark Runner

Runs benchmarks with parallelism and checkpointing.

```typescript
// core/runner.ts
import pLimit from 'p-limit';

export class BenchmarkRunner {
  constructor(
    private registry: Registry,
    private resultsStore: ResultsStore,
    private checkpointManager: CheckpointManager,
  ) {}

  async run(options: {
    benchmarks: string[];
    providers: string[];
    limit?: number;
    concurrency?: number;
    runId?: string;
  }): Promise<RunResult> {
    const runId = options.runId || this.generateRunId();
    const limit = pLimit(options.concurrency || 10);

    const tasks: Promise<void>[] = [];

    for (const benchmarkName of options.benchmarks) {
      const benchmark = this.registry.getBenchmark(benchmarkName);
      const data = await this.loadBenchmarkData(benchmark, options.limit);

      for (const providerName of options.providers) {
        const provider = await this.createProvider(providerName);
        const runTag = this.formatRunTag(benchmark, runId);

        tasks.push(
          limit(() => this.runSingle({
            benchmark,
            provider,
            data,
            runId,
            runTag,
          }))
        );
      }
    }

    await Promise.all(tasks);

    return this.resultsStore.getRunResults(runId);
  }

  private async runSingle(options: {
    benchmark: BenchmarkConfig;
    provider: Provider;
    data: BenchmarkItem[];
    runId: string;
    runTag: string;
  }): Promise<void> {
    const { benchmark, provider, data, runId, runTag } = options;

    // Ingestion phase
    for (const item of data) {
      if (await this.checkpointManager.shouldSkip(runId, item.id, 'ingest')) {
        continue;
      }

      const contexts = this.prepareContexts(benchmark, item);
      for (const context of contexts) {
        await provider.addContext(context, runTag);
      }

      await this.checkpointManager.markComplete(runId, item.id, 'ingest');
    }

    // Search & Evaluate phase
    for (const item of data) {
      if (await this.checkpointManager.shouldSkip(runId, item.id, 'evaluate')) {
        continue;
      }

      const results = await provider.searchQuery(item.question, runTag);
      const evaluation = await this.evaluate(benchmark, item, results);

      await this.resultsStore.saveResult({
        runId,
        benchmark: benchmark.name,
        provider: provider.name,
        itemId: item.id,
        question: item.question,
        expected: item.answer,
        results,
        evaluation,
      });

      await this.checkpointManager.markComplete(runId, item.id, 'evaluate');
    }

    // Cleanup
    await provider.clear(runTag);
  }
}
```

### Results Storage

SQLite-based storage for evaluation results.

```typescript
// core/results.ts
import Database from 'better-sqlite3';

export class ResultsStore {
  private db: Database.Database;

  constructor(dbPath: string = './results.db') {
    this.db = new Database(dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        started_at TEXT,
        completed_at TEXT,
        config TEXT
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT,
        benchmark TEXT,
        provider TEXT,
        item_id TEXT,
        question TEXT,
        expected TEXT,
        actual TEXT,
        score REAL,
        correct INTEGER,
        metadata TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (run_id) REFERENCES runs(id)
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_results_run ON results(run_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_results_benchmark ON results(benchmark)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_results_provider ON results(provider)`);
  }

  async saveResult(result: EvalResult): Promise<void> {
    this.db.prepare(`
      INSERT INTO results (run_id, benchmark, provider, item_id, question, expected, actual, score, correct, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      result.runId,
      result.benchmark,
      result.provider,
      result.itemId,
      result.question,
      result.expected,
      result.actual,
      result.score,
      result.correct ? 1 : 0,
      JSON.stringify(result.metadata),
    );
  }

  async getRunResults(runId: string): Promise<RunResult> {
    const results = this.db.prepare(`
      SELECT * FROM results WHERE run_id = ?
    `).all(runId);

    return this.aggregateResults(results);
  }

  async compareProviders(benchmark: string, providers: string[]): Promise<Comparison> {
    const placeholders = providers.map(() => '?').join(',');
    const results = this.db.prepare(`
      SELECT provider,
             COUNT(*) as total,
             SUM(correct) as correct,
             AVG(score) as avg_score
      FROM results
      WHERE benchmark = ? AND provider IN (${placeholders})
      GROUP BY provider
    `).all(benchmark, ...providers);

    return results;
  }
}
```

### Checkpoint Manager

Manages resumability with JSON-based checkpoint files (inspired by LongMemEval shell scripts).

```typescript
// core/checkpoint.ts

interface CheckpointItem {
  itemId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  timestamp: string;
  phase: 'ingest' | 'search' | 'evaluate';
  error?: string;
}

interface Checkpoint {
  runId: string;
  benchmark: string;
  provider: string;
  questionType?: string;         // Optional filter
  startPosition?: number;        // For position ranges
  endPosition?: number;
  items: CheckpointItem[];
  createdAt: string;
  updatedAt: string;
}

export class CheckpointManager {
  private checkpointsDir: string;

  constructor(baseDir: string = './checkpoints') {
    this.checkpointsDir = baseDir;
  }

  private getCheckpointPath(runId: string, benchmark: string, provider: string): string {
    return `${this.checkpointsDir}/${runId}/${benchmark}-${provider}.json`;
  }

  async loadOrCreate(runId: string, benchmark: string, provider: string): Promise<Checkpoint> {
    const path = this.getCheckpointPath(runId, benchmark, provider);
    
    if (await Bun.file(path).exists()) {
      return JSON.parse(await Bun.file(path).text());
    }

    const checkpoint: Checkpoint = {
      runId,
      benchmark,
      provider,
      items: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.save(checkpoint);
    return checkpoint;
  }

  async shouldSkip(runId: string, itemId: string, phase: string): Promise<boolean> {
    const checkpoint = await this.load(runId);
    if (!checkpoint) return false;
    
    const item = checkpoint.items.find(i => i.itemId === itemId);
    return item?.status === 'completed' && item.phase === phase;
  }

  async markInProgress(runId: string, itemId: string, phase: string): Promise<void> {
    await this.updateItem(runId, itemId, {
      status: 'in_progress',
      phase,
      timestamp: new Date().toISOString(),
    });
  }

  async markComplete(runId: string, itemId: string, phase: string): Promise<void> {
    await this.updateItem(runId, itemId, {
      status: 'completed',
      phase,
      timestamp: new Date().toISOString(),
    });
  }

  async markFailed(runId: string, itemId: string, phase: string, error: string): Promise<void> {
    await this.updateItem(runId, itemId, {
      status: 'failed',
      phase,
      timestamp: new Date().toISOString(),
      error,
    });
  }

  async getProgress(runId: string): Promise<{
    total: number;
    completed: number;
    failed: number;
    inProgress: number;
  }> {
    const checkpoint = await this.load(runId);
    if (!checkpoint) return { total: 0, completed: 0, failed: 0, inProgress: 0 };

    return {
      total: checkpoint.items.length,
      completed: checkpoint.items.filter(i => i.status === 'completed').length,
      failed: checkpoint.items.filter(i => i.status === 'failed').length,
      inProgress: checkpoint.items.filter(i => i.status === 'in_progress').length,
    };
  }

  private async save(checkpoint: Checkpoint): Promise<void> {
    const path = this.getCheckpointPath(checkpoint.runId, checkpoint.benchmark, checkpoint.provider);
    await Bun.write(path, JSON.stringify(checkpoint, null, 2));
  }
}
```

**Checkpoint File Example:**

```json
{
  "runId": "run-2025-12-16-001",
  "benchmark": "longmemeval",
  "provider": "supermemory",
  "questionType": "temporal-reasoning",
  "startPosition": 1,
  "endPosition": 50,
  "items": [
    {
      "itemId": "question_001",
      "status": "completed",
      "phase": "evaluate",
      "timestamp": "2025-12-16T10:30:00Z"
    },
    {
      "itemId": "question_002",
      "status": "in_progress",
      "phase": "search",
      "timestamp": "2025-12-16T10:31:00Z"
    },
    {
      "itemId": "question_003",
      "status": "failed",
      "phase": "ingest",
      "timestamp": "2025-12-16T10:32:00Z",
      "error": "API rate limit exceeded"
    }
  ],
  "createdAt": "2025-12-16T10:00:00Z",
  "updatedAt": "2025-12-16T10:32:00Z"
}
```

---

## Adding New Providers

### Option A: Hosted API (config only)

1. Create config file:
   ```bash
   touch providers/configs/newprovider.yaml
   ```

2. Define the config (copy from template):
   ```yaml
   name: newprovider
   displayName: "New Provider"
   type: hosted

   connection:
     baseUrl: "${NEWPROVIDER_API_URL:-https://api.newprovider.com/v1}"

   auth:
     type: bearer
     envVar: "NEWPROVIDER_API_KEY"

   # ... endpoints
   ```

3. Done! Use with:
   ```bash
   memorybench eval --providers newprovider --benchmarks locomo
   ```

### Option B: Custom Algorithm (config + code)

1. Create config file:
   ```yaml
   name: myalgorithm
   type: local
   adapter: "./adapters/myalgorithm.ts"
   ```

2. Create adapter:
   ```typescript
   // providers/adapters/myalgorithm.ts
   import { LocalProvider } from '../base/local-provider';

   export default class MyAlgorithmProvider extends LocalProvider {
     async addContext(data: PreparedData): Promise<void> {
       // Custom implementation
     }

     async searchQuery(query: string): Promise<SearchResult[]> {
       // Custom implementation
     }
   }
   ```

3. Done!

---

## Adding New Benchmarks

1. Create config file:
   ```bash
   touch benchmarks/configs/newbench.yaml
   ```

2. Add dataset:
   ```bash
   cp data.json benchmarks/datasets/newbench.json
   ```

3. Define schema mapping:
   ```yaml
   name: newbench
   displayName: "New Benchmark"

   data:
     type: local
     path: "./datasets/newbench.json"

   schema:
     itemId: "id"
     question: "query"
     answer: "expected"
     context:
       field: "documents"
       # ...

   evaluation:
     method: exact-match
   ```

4. Done! Use with:
   ```bash
   memorybench eval --benchmarks newbench --providers supermemory
   ```

---

## Implementation Roadmap

### Phase 1: Core Infrastructure
- [ ] Config schemas with Zod validation
- [ ] Registry with auto-discovery
- [ ] HTTP provider adapter
- [ ] CLI skeleton (list, describe)

### Phase 2: Execution Engine
- [ ] Benchmark data loader
- [ ] Runner with parallelism
- [ ] Checkpoint manager
- [ ] Results storage (SQLite)

### Phase 3: Evaluation
- [ ] LLM judge integration
- [ ] Metrics calculator
- [ ] Results aggregation

### Phase 4: Polish
- [ ] CLI commands (eval, results, export)
- [ ] Progress display
- [ ] Error handling
- [ ] Documentation

---

## Research Sources

### Provider APIs
- [Supermemory Docs](https://docs.supermemory.ai)
- [Mem0 API Reference](https://docs.mem0.ai/api-reference)
- [Letta Documentation](https://docs.letta.com)
- [Zep Memory API](https://help.getzep.com/v2/memory)

### Benchmarks
- [LongMemEval Paper](https://arxiv.org/abs/2410.10813)
- [LoCoMo Paper](https://arxiv.org/abs/2402.17753)
- [NoLiMa Paper](https://arxiv.org/abs/2502.05167)

### Architecture Inspiration
- [OpenBench by Groq](https://github.com/groq/openbench)
- [Inspect AI](https://inspect.ai-safety-institute.org.uk/)
