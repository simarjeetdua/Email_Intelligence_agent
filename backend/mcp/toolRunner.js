
import { getComposioTools } from "./composioClient.js";

function normalizeName(name = "") {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

function getTools() {
  const tools = getComposioTools();

  if (!Array.isArray(tools) || tools.length === 0) {
    throw new Error("Composio tools are not initialized");
  }

  return tools;
}

function findTool(slug) {
  const normalizedSlug = normalizeName(slug);

  const tool = getTools().find((item) => {
    const name = normalizeName(item.name);

    return (
      name === normalizedSlug ||
      name.endsWith(`_${normalizedSlug}`)
    );
  });

  if (!tool) {
    throw new Error(
      `Composio tool not found: ${slug}. Available: ${
        getTools().map((item) => item.name).join(", ")
      }`
    );
  }

  return tool;
}

// Supports both JSON Schema and Zod schemas.
function getSchemaKeys(tool) {
  const schema = tool.schema;

  if (schema?.properties) {
    return Object.keys(schema.properties);
  }

  if (schema?.shape) {
    return Object.keys(schema.shape);
  }

  if (schema?._def?.shape) {
    const shape =
      typeof schema._def.shape === "function"
        ? schema._def.shape()
        : schema._def.shape;

    return Object.keys(shape);
  }

  return null;
}

export async function executeComposioTool(
  slug,
  argumentsObject = {}
) {
  const tool = findTool(slug);

  if (typeof tool.invoke !== "function") {
    throw new Error(`Tool ${tool.name} has no invoke() method`);
  }

  const schemaKeys = getSchemaKeys(tool);

  const args = schemaKeys
    ? Object.fromEntries(
        Object.entries(argumentsObject).filter(([key]) =>
          schemaKeys.includes(key)
        )
      )
    : argumentsObject;

  console.log(`[Composio] Executing ${tool.name}`);
  console.log("[Composio] Arguments:", Object.keys(args));

  return await tool.invoke(args);
}

export function inspectComposioTool(slug) {
  const tool = findTool(slug);

  console.log("\n========== COMPOSIO TOOL INSPECTION ==========");
  console.log("Name:", tool.name);
  console.log("Description:", tool.description);
  console.dir(tool.schema, { depth: 10 });
  console.log("==============================================");

  return tool;
}

export function inspectAllComposioTools() {
  for (const tool of getTools()) {
    console.log(`\n${tool.name}`);
    console.log(tool.description);
    console.dir(tool.schema, { depth: 5 });
  }
}
