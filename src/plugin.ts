/**
 * OpenClaw plugin entry point.
 *
 * Registers the "sonzai" ContextEngine and optional tools (knowledge base
 * search, memory search) with OpenClaw's plugin system.
 */

import { Sonzai } from "@sonzai-labs/agents";
import { resolveConfig } from "./config.js";
import { SonzaiContextEngine } from "./engine.js";
import type { PluginAPI, ContextEngine } from "./types.js";

export default function register(api: PluginAPI): void {
  const config = resolveConfig();
  const client = new Sonzai({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });

  // ── Context Engine ──
  api.registerContextEngine("sonzai", (): ContextEngine => {
    return new SonzaiContextEngine(client, config);
  });

  // ── Tools ── (optional: only if the host supports registerTool)
  if (typeof api.registerTool === "function") {
    registerSonzaiTools(api, client, config);
  }
}

/**
 * Register Sonzai tools as OpenClaw-callable tools.
 * These let the LLM explicitly search KB and memory mid-conversation.
 */
function registerSonzaiTools(
  api: PluginAPI,
  client: Sonzai,
  config: ReturnType<typeof resolveConfig>,
): void {
  // Resolve agent ID at call time (may need auto-provision first call).
  let resolvedAgentId: string | undefined = config.agentId;

  const getAgentId = async (): Promise<string> => {
    if (resolvedAgentId) return resolvedAgentId;
    // Auto-provision (same deterministic logic as the engine).
    const agent = await client.agents.create({ name: config.agentName });
    resolvedAgentId = agent.agent_id;
    return resolvedAgentId;
  };

  // ── Knowledge Base Search ──
  api.registerTool!(
    {
      name: "sonzai_knowledge_search",
      description:
        "Search the agent's knowledge base for relevant documents, facts, and reference material. " +
        "Use this when the user asks about topics that may be covered by uploaded documents or structured data.",
      parameters: {
        type: "object",
        required: ["query"],
        properties: {
          query: {
            type: "string",
            description: "The search query — a question or topic to look up",
          },
          limit: {
            type: "integer",
            description: "Maximum number of results to return (default: 5)",
          },
        },
      },
      async execute(_id: string, params: Record<string, unknown>) {
        const agentId = await getAgentId();
        const query = String(params.query || "");
        const limit = Number(params.limit) || 5;

        const response = await client.agents.knowledgeSearch(agentId, {
          query,
          limit,
        });

        if (!response.results || response.results.length === 0) {
          return {
            content: [{ type: "text", text: "No relevant knowledge base results found." }],
          };
        }

        const text = response.results
          .map(
            (r: { label: string; content: string; source?: string }, i: number) =>
              `${i + 1}. **${r.label}**${r.source ? ` [source: ${r.source}]` : ""}\n${r.content}`,
          )
          .join("\n\n");

        return { content: [{ type: "text", text }] };
      },
    },
    { optional: true },
  );

  // ── Memory Search ──
  api.registerTool!(
    {
      name: "sonzai_memory_search",
      description:
        "Search the agent's memory for previously learned facts about the user. " +
        "Use this when the conversation references past interactions, personal details, " +
        "or commitments that the agent should remember.",
      parameters: {
        type: "object",
        required: ["query"],
        properties: {
          query: {
            type: "string",
            description: "The search query — what to look up in memory",
          },
        },
      },
      async execute(_id: string, params: Record<string, unknown>) {
        const agentId = await getAgentId();
        const query = String(params.query || "");

        // Memory facts are per-user — without user_id the server falls
        // back to the unscoped row and returns either nothing or facts
        // from a different user. We don't have access to the current
        // session's userId here (tool callbacks run outside the engine's
        // session-tracking map), so pass the configured defaultUserId
        // — the same identity bootstrap() uses for single-peer CLI
        // sessions where the session key has no explicit user segment.
        const response = await client.agents.memory.search(agentId, {
          query,
          user_id: config.defaultUserId,
        });

        if (!response.results || response.results.length === 0) {
          return {
            content: [{ type: "text", text: "No matching memories found." }],
          };
        }

        const text = response.results
          .map(
            (r: { content: string; fact_type?: string }, i: number) =>
              `${i + 1}. [${r.fact_type || "fact"}] ${r.content}`,
          )
          .join("\n");

        return { content: [{ type: "text", text }] };
      },
    },
    { optional: true },
  );
}
