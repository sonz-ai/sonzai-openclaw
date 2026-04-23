/**
 * SonzaiContextEngine — bridges OpenClaw lifecycle hooks to the
 * Sonzai Mind Layer API via @sonzai-labs/agents.
 */

import type { Sonzai } from "@sonzai-labs/agents";
import { SessionCache } from "./cache.js";
import { buildSystemPromptFromContext, estimateTokens } from "./context-builder.js";
import type { ResolvedConfig } from "./config.js";
import { parseSessionKey } from "./session-key.js";
import { isSessionResetPrompt } from "./session-reset.js";
import type {
  AfterTurnArgs,
  AssembleArgs,
  AssembleResult,
  BootstrapArgs,
  CompactArgs,
  CompactResult,
  ContextEngine,
  ContextEngineInfo,
  IngestArgs,
  MessageItem,
  SessionState,
} from "./types.js";

// Cache TTLs
// Profile/behavioral caching is now handled server-side by Redis layer caches.
const AGENT_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export class SonzaiContextEngine implements ContextEngine {
  readonly info: ContextEngineInfo = {
    id: "sonzai",
    name: "Sonzai Mind Layer",
    ownsCompaction: true,
  };

  private readonly sessions = new Map<string, SessionState>();
  private readonly agentCache = new SessionCache<string>(AGENT_CACHE_TTL);

  constructor(
    private readonly client: Sonzai,
    private readonly config: ResolvedConfig,
  ) {}

  // -------------------------------------------------------------------------
  // bootstrap — initialize session, optionally auto-provision agent
  // -------------------------------------------------------------------------

  async bootstrap({ sessionId }: BootstrapArgs): Promise<void> {
    try {
      const parsed = parseSessionKey(sessionId, this.config.defaultUserId);
      const agentId = await this.resolveAgentId(parsed.agentId);

      // Start a Sonzai session
      await this.client.agents.sessions.start(agentId, {
        userId: parsed.userId,
        sessionId,
      });

      this.sessions.set(sessionId, {
        agentId,
        userId: parsed.userId,
        sonzaiSessionId: sessionId,
        startedAt: Date.now(),
        turnCount: 0,
        lastProcessedIndex: 0,
        lastMessages: [],
      });
    } catch (err) {
      console.warn("[@sonzai-labs/openclaw-context] bootstrap failed:", err);
    }
  }

  // -------------------------------------------------------------------------
  // ingest — no-op; processing happens in afterTurn with full conversation
  // -------------------------------------------------------------------------

  async ingest(_args: IngestArgs): Promise<{ ingested: boolean }> {
    return { ingested: true };
  }

  // -------------------------------------------------------------------------
  // assemble — fetch enriched context and inject as systemPromptAddition
  // -------------------------------------------------------------------------

  async assemble({
    sessionId,
    messages,
    tokenBudget,
    origin,
  }: AssembleArgs): Promise<AssembleResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { messages, estimatedTokens: 0 };
    }

    // Store messages for afterTurn processing
    session.lastMessages = messages;

    try {
      const { agentId, userId } = session;
      const lastUserMsg = findLastUserMessage(messages);
      if (isSessionResetPrompt(lastUserMsg)) {
        return { messages, estimatedTokens: 0 };
      }
      const budget = Math.min(tokenBudget, this.config.contextTokenBudget);

      // Resolve userId for group chats: prefer origin.from if available
      const effectiveUserId =
        origin?.from && origin?.provider
          ? `${origin.provider}:${origin.from}`
          : userId;

      // Single API call replaces 7 parallel calls — server-side caching
      // handles profile (5min), behavioral (30s), constellation (5min),
      // and memory (2h session cache) acceleration.
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const context = await this.client.agents.getContext(agentId, {
        userId: effectiveUserId,
        sessionId: session.sonzaiSessionId,
        query: lastUserMsg,
        timezone,
      });

      const systemPromptAddition = buildSystemPromptFromContext(
        context,
        budget,
        this.config.disable,
      );

      return {
        messages,
        estimatedTokens: estimateTokens(systemPromptAddition),
        systemPromptAddition: systemPromptAddition || undefined,
      };
    } catch (err) {
      console.warn("[@sonzai-labs/openclaw-context] assemble failed:", err);
      return { messages, estimatedTokens: 0 };
    }
  }

  // -------------------------------------------------------------------------
  // compact — trigger Sonzai's consolidation pipeline
  // -------------------------------------------------------------------------

  async compact({ sessionId }: CompactArgs): Promise<CompactResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { ok: false, compacted: false };
    }

    try {
      await this.client.agents.consolidate(session.agentId);
      return { ok: true, compacted: true };
    } catch (err) {
      console.warn("[@sonzai-labs/openclaw-context] compact failed:", err);
      return { ok: false, compacted: false };
    }
  }

  // -------------------------------------------------------------------------
  // afterTurn — send new messages for fact extraction
  // -------------------------------------------------------------------------

  async afterTurn({ sessionId }: AfterTurnArgs): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      session.turnCount++;

      // Only send messages added since last afterTurn
      const newMessages = session.lastMessages.slice(session.lastProcessedIndex);
      session.lastProcessedIndex = session.lastMessages.length;

      if (newMessages.length === 0) return;

      await this.client.agents.process(session.agentId, {
        userId: session.userId,
        sessionId: session.sonzaiSessionId,
        messages: newMessages.map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        })),
        provider: this.config.extractionProvider,
        model: this.config.extractionModel,
      });
    } catch (err) {
      console.warn("[@sonzai-labs/openclaw-context] afterTurn failed:", err);
    }
  }

  // -------------------------------------------------------------------------
  // dispose — end all active sessions and clear caches
  // -------------------------------------------------------------------------

  async dispose(): Promise<void> {
    const endPromises = [...this.sessions.entries()].map(
      async ([_sessionId, session]) => {
        try {
          await this.client.agents.sessions.end(session.agentId, {
            userId: session.userId,
            sessionId: session.sonzaiSessionId,
            totalMessages: session.turnCount,
            durationSeconds: Math.floor(
              (Date.now() - session.startedAt) / 1000,
            ),
          });
        } catch {
          // Best-effort cleanup
        }
      },
    );

    await Promise.allSettled(endPromises);
    this.sessions.clear();
    this.agentCache.clear();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Resolve the Sonzai agent ID: use config if provided, otherwise
   * auto-provision via the idempotent create endpoint.
   *
   * Idempotency guarantee: the backend derives a deterministic UUID v5 from
   * `SHA1(namespace, tenantID + "/" + lowercase(name))`. Same API key (tenant)
   * + same name → same UUID on every call, even across restarts or pod
   * replacements.
   *
   * The name used is always `config.agentName` (default: "openclaw-agent").
   * This is stable because it comes from the plugin config / env var, not
   * from any runtime state like pod IDs or session UUIDs.
   *
   * If a B2B client needs multiple distinct agents under one API key, they
   * set a unique `agentName` per OpenClaw instance in their config.
   */
  private async resolveAgentId(_sessionAgentId: string | null): Promise<string> {
    if (this.config.agentId) {
      return this.config.agentId;
    }

    const name = this.config.agentName;

    // Check cache
    const cached = this.agentCache.get(name);
    if (cached) return cached;

    // Auto-provision — idempotent (returns 200 if exists, 201 if new)
    const agent = await this.client.agents.create({ name });

    this.agentCache.set(name, agent.agent_id);
    return agent.agent_id;
  }

}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Find the last user message content from the conversation. */
function findLastUserMessage(messages: MessageItem[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") {
      return messages[i]!.content;
    }
  }
  return undefined;
}
