import { loadBenchmarkData } from "./benchmarks/loaders/index.ts";
import { readFileSync } from "fs";

const configPath = "./benchmarks/configs/locomo.yaml";
const yamlContent = readFileSync(configPath, 'utf-8');

// Parse YAML
import { parse } from "yaml";
const config = parse(yamlContent);

console.log("=== CONFIG ===");
console.log("Schema:", JSON.stringify(config.schema, null, 2));

const items = await loadBenchmarkData(config, { limit: 1 });

console.log("\n=== LOADED DATA ===");
console.log("Total items:", items.length);

if (items.length > 0) {
  const item = items[0]!;
  console.log("\nFirst item:");
  console.log("ID:", item.id);
  console.log("Question:", item.question);
  console.log("Answer:", item.answer);
  console.log("Contexts count:", item.contexts.length);
  console.log("Metadata:", item.metadata);
  
  if (item.contexts.length > 0) {
    const firstContext = item.contexts[0]!;
    console.log("\nFirst context:");
    console.log("ID:", firstContext.id);
    console.log("Content preview:", firstContext.content.substring(0, 200));
  }
}
