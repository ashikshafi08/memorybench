/**
 * Core configuration schemas for memorybench.
 * Defines Zod schemas for provider and benchmark YAML configs.
 */

import { z } from "zod";

// ============================================================================
// Provider Configuration Schema
// ============================================================================

const AuthConfigSchema = z.object({
	type: z.enum(["bearer", "token", "apikey", "none"]).default("none"),
	header: z.string().default("Authorization"),
	prefix: z.string().optional(),
	envVar: z.string().optional(),
});

const ConnectionConfigSchema = z.object({
	baseUrl: z.string(),
	timeout: z.number().default(30000),
});

const DockerConfigSchema = z.object({
	compose: z.string(),
	service: z.string(),
	healthcheck: z.string(),
	baseUrl: z.string(),
});

const ScopingConfigSchema = z.object({
	strategy: z
		.enum(["containerTags", "userId", "sessionId", "custom"])
		.default("containerTags"),
	runIdFormat: z.string().default("${benchmarkId}-${runId}"),
});

const EndpointBodySchema = z.record(z.string(), z.unknown());

const EndpointResponseSchema = z.object({
	results: z.string(),
	contentField: z.string(),
	scoreField: z.string().optional(),
	chunksField: z.string().optional(),
});

const EndpointConfigSchema = z.object({
	method: z.enum(["GET", "POST", "PUT", "DELETE"]),
	path: z.string(),
	body: EndpointBodySchema.optional(),
	params: EndpointBodySchema.optional(),
	response: EndpointResponseSchema.optional(),
});

const EndpointsConfigSchema = z.object({
	add: EndpointConfigSchema,
	search: EndpointConfigSchema,
	clear: EndpointConfigSchema.optional(),
});

const CapabilitiesConfigSchema = z.object({
	supportsChunks: z.boolean().default(false),
	supportsBatch: z.boolean().default(false),
	supportsMetadata: z.boolean().default(true),
	supportsRerank: z.boolean().default(false),
});

const RateLimitConfigSchema = z.object({
	addDelayMs: z.number().default(0),
	searchDelayMs: z.number().default(0),
	batchDelayMs: z.number().default(1000),
	maxRetries: z.number().default(3),
	retryDelayMs: z.number().default(2000),
});

const LocalProviderConfigSchema = z.object({
	database: z
		.object({
			type: z.enum(["postgres", "sqlite", "memory"]).optional(),
			connectionString: z.string().optional(),
			schema: z.string().optional(),
		})
		.optional(),
	chunking: z
		.object({
			size: z.number().default(1024),
			overlap: z.number().default(96),
			strategy: z.enum(["fixed", "semantic", "paragraph"]).default("fixed"),
		})
		.optional(),
	embedding: z
		.object({
			provider: z.string().optional(),
			model: z.string().optional(),
			dimensions: z.number().optional(),
		})
		.optional(),
	enhancement: z
		.object({
			enabled: z.boolean().default(false),
			model: z.string().optional(),
			generateQuestions: z.boolean().default(false),
			questionsPerChunk: z.number().default(10),
		})
		.optional(),
	retrieval: z
		.object({
			strategy: z.enum(["simple", "weighted", "hybrid"]).default("simple"),
			maxResults: z.number().default(10),
			weights: z.record(z.string(), z.number()).optional(),
		})
		.optional(),
});

export const ProviderConfigSchema = z.object({
	// Identity
	name: z.string(),
	displayName: z.string(),
	description: z.string().optional(),
	type: z.enum(["hosted", "local", "docker"]),
	tags: z.array(z.string()).optional(),

	// For hosted providers
	connection: ConnectionConfigSchema.optional(),
	auth: AuthConfigSchema.optional(),
	endpoints: EndpointsConfigSchema.optional(),

	// For local providers
	adapter: z.string().optional(),
	local: LocalProviderConfigSchema.optional(),

	// For docker providers
	docker: DockerConfigSchema.optional(),

	// Common
	scoping: ScopingConfigSchema.optional(),
	capabilities: CapabilitiesConfigSchema.optional(),
	rateLimit: RateLimitConfigSchema.optional(),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

// ============================================================================
// Benchmark Configuration Schema
// ============================================================================

const DataSourceSchema = z.object({
	type: z.enum(["huggingface", "local", "url"]),
	path: z.string(),
	localPath: z.string().optional(),
	format: z.enum(["json", "jsonl", "csv"]).default("json"),
});

const ContextSchemaSchema = z.object({
	field: z.string(),
	type: z.enum(["array", "object", "string"]).default("array"),
	dateField: z.string().optional(),
	sessionPattern: z.string().optional(),
	datePattern: z.string().optional(),
	itemSchema: z
		.object({
			content: z.string().optional(),
			role: z.string().optional(),
			speaker: z.string().optional(),
			text: z.string().optional(),
			dialogId: z.string().optional(),
		})
		.optional(),
});

const QuestionsSchema = z.object({
	field: z.string(),
	questionField: z.string(),
	answerField: z.string(),
	evidenceField: z.string().optional(),
	categoryField: z.string().optional(),
});

const BenchmarkSchemaSchema = z.object({
	itemId: z.string(),
	question: z.string().optional(),
	answer: z.string().optional(),
	questions: QuestionsSchema.optional(),
	context: ContextSchemaSchema.optional(),
	metadata: z.record(z.string(), z.string()).optional(),
});

const QuestionTypeSchema = z.object({
	name: z.string(),
	evaluationPrompt: z.string().optional(),
	allowOffByOne: z.boolean().optional(),
});

const IngestionConfigSchema = z.object({
	mode: z.enum(["bulk", "incremental", "session-based"]).default("bulk"),
	batchSize: z.number().default(1),
	delayBetweenBatches: z.number().default(0),
	preprocessing: z
		.object({
			escapeHtml: z.boolean().optional(),
			removeFields: z.array(z.string()).optional(),
			formatTemplate: z.string().optional(),
		})
		.optional(),
});

const SearchConfigSchema = z.object({
	defaultLimit: z.number().default(10),
	defaultThreshold: z.number().default(0.3),
	includeChunks: z.boolean().default(false),
});

const AnswerPromptConfigSchema = z.object({
	default: z.string(),
	byQuestionType: z.record(z.string(), z.string()).optional(),
	userOverride: z.boolean().default(true),
});

const JudgePromptsConfigSchema = z.object({
	source: z.enum(["paper", "custom"]).default("paper"),
	paperReference: z.string().optional(),
	default: z.string(),
	byQuestionType: z.record(z.string(), z.string()).optional(),
	userOverride: z.boolean().default(true),
});

const EvaluationConfigSchema = z.object({
	method: z
		.enum(["exact-match", "llm-judge", "semantic-similarity", "custom"])
		.default("llm-judge"),
	answeringModel: z
		.object({
			model: z.string().default("gpt-4o"),
			temperature: z.number().default(0),
		})
		.optional(),
	answerPrompt: AnswerPromptConfigSchema.optional(),
	judge: z
		.object({
			model: z.string().default("gpt-4o"),
			temperature: z.number().default(0),
		})
		.optional(),
	judgePrompts: JudgePromptsConfigSchema.optional(),
	customEvaluator: z.string().optional(),
});

const RuntimeConfigSchema = z.object({
	checkpointing: z.boolean().default(true),
	checkpointGranularity: z.enum(["item", "batch", "session"]).default("item"),
	resumable: z.boolean().default(true),
});

export const BenchmarkConfigSchema = z.object({
	// Identity
	name: z.string(),
	displayName: z.string(),
	description: z.string().optional(),
	version: z.string().optional(),
	source: z.string().optional(),
	paper: z.string().optional(),
	tags: z.array(z.string()).optional(),

	// Data source
	data: DataSourceSchema,

	// Schema mapping
	schema: BenchmarkSchemaSchema,

	// Question types
	questionTypes: z.array(QuestionTypeSchema).optional(),
	categories: z.record(z.string(), z.string()).optional(),

	// Configuration
	ingestion: IngestionConfigSchema.optional(),
	search: SearchConfigSchema.optional(),
	evaluation: EvaluationConfigSchema.optional(),
	metrics: z.array(z.string()).optional(),
	runtime: RuntimeConfigSchema.optional(),
});

export type BenchmarkConfig = z.infer<typeof BenchmarkConfigSchema>;

// ============================================================================
// Helper types for runtime use
// ============================================================================

export interface PreparedData {
	id: string;
	content: string;
	metadata: Record<string, unknown>;
}

export interface SearchResult {
	id: string;
	content: string;
	score: number;
	chunks?: Array<{ content: string; score: number }>;
	metadata?: Record<string, unknown>;
}

export interface BenchmarkItem {
	id: string;
	question: string;
	answer: string;
	contexts: PreparedData[];
	metadata: Record<string, unknown>;
	questionType?: string;
	category?: string;
}

export interface EvalResult {
	runId: string;
	benchmark: string;
	provider: string;
	itemId: string;
	question: string;
	expected: string;
	actual: string;
	score: number;
	correct: boolean;
	retrievedContext: SearchResult[];
	metadata: Record<string, unknown>;
}

