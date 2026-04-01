/**
 * SonzaiContextEngine — bridges OpenClaw lifecycle hooks to the
 * Sonzai Mind Layer API via @sonzai-labs/agents.
 */

import type { Sonzai, PersonalityResponse } from "@sonzai-labs/agents";
import { SessionCache } from "./cache.js";
import { buildSystemPromptAddition, estimateTokens } from "./context-builder.js";
import type { ResolvedConfig } from "./config.js";
import { parseSessionKey } from "./session-key.js";
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
const PERSONALITY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const AGENT_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export class SonzaiContextEngine implements ContextEngine {
  readonly info: ContextEngineInfo = {
    id: "sonzai",
    name: "Sonzai Mind Layer",
    ownsCompaction: true,
  };

  private readonly sessions = new Map<string, SessionState>();
  private readonly personalityCache = new SessionCache<PersonalityResponse>(PERSONALITY_CACHE_TTL);
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
      const budget = Math.min(tokenBudget, this.config.contextTokenBudget);
      const disable = this.config.disable;

      // Resolve userId for group chats: prefer origin.from if available
      const effectiveUserId =
        origin?.from && origin?.provider
          ? `${origin.provider}:${origin.from}`
          : userId;

      // Fire all context fetches in parallel — any failure is non-fatal
      const [
        memoriesResult,
        moodResult,
        personalityResult,
        relationshipsResult,
        goalsResult,
        interestsResult,
        habitsResult,
      ] = await Promise.allSettled([
        !disable.memory && lastUserMsg
          ? this.client.agents.memory.search(agentId, { query: lastUserMsg })
          : Promise.resolve(undefined),
        !disable.mood
          ? this.client.agents.getMood(agentId, { userId: effectiveUserId })
          : Promise.resolve(undefined),
        !disable.personality
          ? this.getCachedPersonality(agentId)
          : Promise.resolve(undefined),
        !disable.relationships
          ? this.client.agents.getRelationships(agentId, { userId: effectiveUserId })
          : Promise.resolve(undefined),
        !disable.goals
          ? this.client.agents.getGoals(agentId, { userId: effectiveUserId })
          : Promise.resolve(undefined),
        !disable.interests
          ? this.client.agents.getInterests(agentId, { userId: effectiveUserId })
          : Promise.resolve(undefined),
        !disable.habits
          ? this.client.agents.getHabits(agentId, { userId: effectiveUserId })
          : Promise.resolve(undefined),
      ]);

      const systemPromptAddition = buildSystemPromptAddition(
        {
          memories: settled(memoriesResult),
          mood: settled(moodResult),
          personality: settled(personalityResult),
          relationships: settled(relationshipsResult),
          goals: settled(goalsResult),
          interests: settled(interestsResult),
          habits: settled(habitsResult),
        },
        budget,
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

      await this.client.agents.sessions.end(session.agentId, {
        userId: session.userId,
        sessionId: session.sonzaiSessionId,
        totalMessages: session.turnCount,
        durationSeconds: Math.floor((Date.now() - session.startedAt) / 1000),
        messages: newMessages.map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        })),
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
    this.personalityCache.clear();
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

  /**
   * Get personality with caching to avoid per-turn re-fetches.
   */
  private async getCachedPersonality(agentId: string): Promise<PersonalityResponse> {
    const cached = this.personalityCache.get(agentId);
    if (cached) return cached;

    const personality = await this.client.agents.personality.get(agentId);
    this.personalityCache.set(agentId, personality);
    return personality;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Extract the fulfilled value from a settled promise, or undefined. */
function settled<T>(result: PromiseSettledResult<T>): T | undefined {
  return result.status === "fulfilled" ? result.value : undefined;
}

/** Find the last user message content from the conversation. */
function findLastUserMessage(messages: MessageItem[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") {
      return messages[i]!.content;
    }
  }
  return undefined;
}
