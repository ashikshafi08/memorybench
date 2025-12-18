/**
 * Factory for creating provider instances from config.
 */

import type { ProviderConfig } from "../core/config.ts";
import type { Provider } from "./base/types.ts";
import { HttpProvider } from "./base/http-provider.ts";
import { AQRAGAdapter } from "./adapters/aqrag.ts";
import { ContextualRetrievalAdapter } from "./adapters/contextual-retrieval.ts";
import { OpenRouterRAGAdapter } from "./adapters/openrouter-rag.ts";

/**
 * Registry of local provider adapters.
 * Keys are adapter paths, values are provider constructors.
 */
const localAdapterRegistry = new Map<
	string,
	new (config: ProviderConfig) => Provider
>();

/**
 * Register a local provider adapter.
 */
export function registerLocalAdapter(
	adapterPath: string,
	ProviderClass: new (config: ProviderConfig) => Provider,
): void {
	localAdapterRegistry.set(adapterPath, ProviderClass);
}

// Pre-register known local adapters
registerLocalAdapter("./adapters/aqrag.ts", AQRAGAdapter);
registerLocalAdapter("./adapters/contextual-retrieval.ts", ContextualRetrievalAdapter);
registerLocalAdapter("./adapters/openrouter-rag.ts", OpenRouterRAGAdapter);

/**
 * Create a provider instance from config.
 */
export async function createProvider(config: ProviderConfig): Promise<Provider> {
	switch (config.type) {
		case "hosted":
			return createHostedProvider(config);

		case "local":
			return createLocalProvider(config);

		case "docker":
			return createDockerProvider(config);

		default:
			throw new Error(`Unknown provider type: ${(config as ProviderConfig).type}`);
	}
}

/**
 * Create a hosted API provider using HttpProvider.
 */
function createHostedProvider(config: ProviderConfig): Provider {
	return new HttpProvider(config);
}

/**
 * Create a local provider by loading its adapter.
 */
async function createLocalProvider(config: ProviderConfig): Promise<Provider> {
	if (!config.adapter) {
		throw new Error(
			`Local provider '${config.name}' requires an 'adapter' path in config`,
		);
	}

	// Check if adapter is registered
	const RegisteredAdapter = localAdapterRegistry.get(config.adapter);
	if (RegisteredAdapter) {
		const provider = new RegisteredAdapter(config);
		if (provider.initialize) {
			await provider.initialize();
		}
		return provider;
	}

	// Try to dynamically import the adapter
	try {
		// Resolve the adapter path relative to the providers directory
		const adapterPath = config.adapter.startsWith("./")
			? `./adapters/${config.adapter.slice(2)}`
			: config.adapter;

		const module = await import(adapterPath);

		// Look for default export or named export matching provider name
		const AdapterClass =
			module.default ??
			module[config.name] ??
			module[`${config.name}Provider`] ??
			module[`${capitalizeFirst(config.name)}Provider`];

		if (!AdapterClass) {
			throw new Error(
				`Could not find provider class in adapter module '${adapterPath}'`,
			);
		}

		// Create instance
		const provider: Provider =
			typeof AdapterClass === "function"
				? AdapterClass.prototype
					? new AdapterClass(config)
					: await AdapterClass(config)
				: AdapterClass;

		if (provider.initialize) {
			await provider.initialize();
		}

		return provider;
	} catch (error) {
		throw new Error(
			`Failed to load local adapter '${config.adapter}' for provider '${config.name}': ${error}`,
		);
	}
}

/**
 * Create a Docker-based provider.
 * Ensures the container is running, then uses HttpProvider.
 */
async function createDockerProvider(config: ProviderConfig): Promise<Provider> {
	if (!config.docker) {
		throw new Error(
			`Docker provider '${config.name}' requires 'docker' config`,
		);
	}

	const { compose, service, healthcheck, baseUrl } = config.docker;

	// Start the Docker service
	await startDockerService(compose, service);

	// Wait for health check
	await waitForHealthCheck(healthcheck);

	// Create an HttpProvider-like config for the running service
	const httpConfig: ProviderConfig = {
		...config,
		type: "hosted",
		connection: {
			baseUrl,
			timeout: config.connection?.timeout ?? 30000,
		},
	};

	return new HttpProvider(httpConfig);
}

/**
 * Start a Docker Compose service.
 */
async function startDockerService(
	composePath: string,
	serviceName: string,
): Promise<void> {
	const proc = Bun.spawn(
		["docker", "compose", "-f", composePath, "up", "-d", serviceName],
		{
			stdout: "pipe",
			stderr: "pipe",
		},
	);

	const exitCode = await proc.exited;

	if (exitCode !== 0) {
		const stderr = await new Response(proc.stderr).text();
		throw new Error(
			`Failed to start Docker service '${serviceName}': ${stderr}`,
		);
	}
}

/**
 * Wait for a health check URL to respond.
 */
async function waitForHealthCheck(
	url: string,
	options: { timeout?: number; interval?: number } = {},
): Promise<void> {
	const timeout = options.timeout ?? 60000;
	const interval = options.interval ?? 1000;
	const startTime = Date.now();

	while (Date.now() - startTime < timeout) {
		try {
			const response = await fetch(url, { method: "GET" });
			if (response.ok) {
				return;
			}
		} catch {
			// Ignore fetch errors, keep trying
		}

		await new Promise((resolve) => setTimeout(resolve, interval));
	}

	throw new Error(`Health check timed out after ${timeout}ms: ${url}`);
}

/**
 * Capitalize the first letter of a string.
 */
function capitalizeFirst(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Create multiple providers from configs.
 */
export async function createProviders(
	configs: ProviderConfig[],
): Promise<Provider[]> {
	return Promise.all(configs.map((config) => createProvider(config)));
}

