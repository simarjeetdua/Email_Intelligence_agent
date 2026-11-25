
import { Composio, SessionPreset } from "@composio/core";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";

let mcpClient;
let availableTools = [];

export async function initializeComposio() {
  try {
    const composio = new Composio({
      apiKey: process.env.COMPOSIO_API_KEY,
    });

    // Create one session for our application user.
    const session = await composio.sessions.create(
      process.env.COMPOSIO_USER_ID,
      {
        toolkits: ["gmail", "telegram"],

        // Only allow these two actions initially.
        tools: {
          gmail: {
            enable: ["GMAIL_FETCH_EMAILS"],
          },
          telegram: {
            enable: ["TELEGRAM_SEND_MESSAGE"],
          },
        },

        // Expose selected tools directly, without
        // broad dynamic tool discovery.
        sessionPreset: SessionPreset.DIRECT_TOOLS,

        // We don't need remote code execution.
        sandbox: {
          enable: false,
        },

        // Enable the hosted MCP endpoint.
        mcp: true,
      }
    );

    console.log("Composio session:", session.sessionId);

    // Connect LangChain MCP adapter.
    mcpClient = new MultiServerMCPClient({
      composio: {
        transport: "http",
        url: session.mcp.url,
        headers: session.mcp.headers,
      },
    });

    availableTools = await mcpClient.getTools();

    console.log("\nConnected Composio MCP tools:");

    availableTools.forEach((tool) => {
      console.log("-", tool.name);
    });

    return availableTools;
  } catch (error) {
    console.error("Composio MCP initialization failed:", error);
    throw error;
  }
}

export function getComposioTools() {
  if (!availableTools.length) {
    throw new Error("Composio tools are not initialized");
  }

  return availableTools;
}
