import { describe, it, expect, vi, beforeEach } from "vitest";
import { SonzaiContextEngine } from "../src/engine.js";
import type { ResolvedConfig } from "../src/config.js";
import { BARE_SESSION_RESET_PROMPT } from "../src/session-reset.js";
import { CONTEXT_BOUNDARY } from "../src/context-builder.js";

// ---------------------------------------------------------------------------
// Mock Sonzai client
// ---------------------------------------------------------------------------

/**
 * Build a fake Session handle that mirrors the public surface the engine
 * uses: context() / turn() / end(). Each method is a fresh vi.fn() so
 * tests can assert against them directly.
 */
function createMockSession() {
  return {
    success: true,
    context: vi.fn().mockResolvedValue({
      personality_prompt: "You are a helpful agent",
      speech_patterns: ["uses metaphors"],
      true_interests: ["coffee", "hiking"],
      primary_traits: ["helpful", "curious"],
      big5: {
        openness: { score: 70 },
        conscientiousness: { score: 60 },
        extraversion: { score: 50 },
        agreeableness: { score: 80 },
        neuroticism: { score: 30 },
      },
      preferences: { pace: "moderate", formality: "casual", humor_style: "warm" },
      current_mood: { valence: 7, arousal: 5, tension: 3, affiliation: 6 },
      relationship_narrative: "Friendly acquaintances",
      love_from_agent: 50,
      love_from_user: 45,
      loaded_facts: [
        { atomic_text: "User likes coffee", fact_type: "preference" },
      ],
      active_goals: [],
      habits: [],
      game_context: {},
    }),
    turn: vi.fn().mockResolvedValue({ success: true, extraction_id: "ext-1", extraction_status: "queued" }),
    status: vi.fn().mockResolvedValue({ extraction_id: "ext-1", state: "done" }),
    end: vi.fn().mockResolvedValue({ success: true }),
  };
}

function createMockClient() {
  const mockSession = createMockSession();
  return {
    /** Exposed for assertions: spies on the bound Session handle. */
    mockSession,
    agents: {
      create: vi.fn().mockResolvedValue({ agent_id: "agent-123", name: "test-agent" }),
      sessions: {
        // Returns the Session handle; engine pins it on SessionState.handle
        // and routes context()/turn()/end() through it.
        start: vi.fn().mockResolvedValue(mockSession),
      },
      consolidate: vi.fn().mockResolvedValue({}),
      updateCapabilities: vi.fn().mockResolvedValue({}),
    },
  } as unknown as {
    mockSession: ReturnType<typeof createMockSession>;
    agents: any;
  };
}

function createConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    apiKey: "sk-test-123",
    agentId: "agent-123",
    baseUrl: "https://api.sonz.ai",
    agentName: "test-agent",
    defaultUserId: "owner",
    contextTokenBudget: 2000,
    disable: {},
    extractionProvider: undefined,
    extractionModel: undefined,
    memoryMode: "sync",
    ...overrides,
  };
}

describe("SonzaiContextEngine", () => {
  let client: ReturnType<typeof createMockClient>;
  let engine: SonzaiContextEngine;

  beforeEach(() => {
    client = createMockClient();
    engine = new SonzaiContextEngine(client as any, createConfig());
  });

  describe("info", () => {
    it("has correct engine metadata", () => {
      expect(engine.info).toEqual({
        id: "sonzai",
        name: "Sonzai Mind Layer",
        ownsCompaction: true,
      });
    });
  });

  describe("bootstrap", () => {
    it("starts a Sonzai session with correct userId", async () => {
      await engine.bootstrap({ sessionId: "agent:abc:telegram:direct:user456" });

      expect((client as any).agents.sessions.start).toHaveBeenCalledWith(
        "agent-123",
        { userId: "user456", sessionId: "agent:abc:telegram:direct:user456" },
      );
    });

    it("uses default userId for CLI session keys", async () => {
      await engine.bootstrap({ sessionId: "agent:abc:mainKey" });

      expect((client as any).agents.sessions.start).toHaveBeenCalledWith(
        "agent-123",
        { userId: "owner", sessionId: "agent:abc:mainKey" },
      );
    });

    it("auto-provisions agent when agentId not in config", async () => {
      engine = new SonzaiContextEngine(
        client as any,
        createConfig({ agentId: undefined }),
      );

      await engine.bootstrap({ sessionId: "agent:abc:mainKey" });

      // Uses config.agentName (stable across restarts/pods, not runtime-derived)
      // and seeds the configured memoryMode at creation time.
      expect((client as any).agents.create).toHaveBeenCalledWith({
        name: "test-agent",
        toolCapabilities: {
          web_search: false,
          remember_name: false,
          image_generation: false,
          inventory: false,
          memory_mode: "sync",
        },
      });
    });

    it("does not throw on failure (graceful degradation)", async () => {
      (client as any).agents.sessions.start.mockRejectedValue(new Error("API down"));

      await expect(
        engine.bootstrap({ sessionId: "agent:abc:mainKey" }),
      ).resolves.not.toThrow();
    });

    it("enforces configured memoryMode via updateCapabilities", async () => {
      await engine.bootstrap({ sessionId: "agent:abc:mainKey" });

      expect((client as any).agents.updateCapabilities).toHaveBeenCalledWith(
        "agent-123",
        { memoryMode: "sync" },
      );
    });

    it("enforces async memoryMode when configured", async () => {
      engine = new SonzaiContextEngine(
        client as any,
        createConfig({ memoryMode: "async" }),
      );

      await engine.bootstrap({ sessionId: "agent:abc:mainKey" });

      expect((client as any).agents.updateCapabilities).toHaveBeenCalledWith(
        "agent-123",
        { memoryMode: "async" },
      );
    });

    it("does not fail bootstrap if updateCapabilities throws", async () => {
      (client as any).agents.updateCapabilities.mockRejectedValue(
        new Error("capability endpoint down"),
      );

      await expect(
        engine.bootstrap({ sessionId: "agent:abc:mainKey" }),
      ).resolves.not.toThrow();

      // Session still starts despite the enforcement failure
      expect((client as any).agents.sessions.start).toHaveBeenCalled();
    });
  });

  describe("ingest", () => {
    it("returns ingested: true (no-op)", async () => {
      const result = await engine.ingest({
        sessionId: "test",
        message: { role: "user", content: "hello" },
        isHeartbeat: false,
      });
      expect(result).toEqual({ ingested: true });
    });
  });

  describe("assemble", () => {
    it("returns pass-through when session not bootstrapped", async () => {
      const messages = [{ role: "user", content: "hello" }];
      const result = await engine.assemble({
        sessionId: "unknown-session",
        messages,
        tokenBudget: 2000,
      });
      expect(result.messages).toBe(messages);
      expect(result.estimatedTokens).toBe(0);
      expect(result.systemPromptAddition).toBeUndefined();
    });

    it("fetches context and injects systemPromptAddition", async () => {
      await engine.bootstrap({ sessionId: "agent:abc:mainKey" });

      const messages = [
        { role: "system", content: "You are an agent" },
        { role: "user", content: "Tell me about coffee" },
      ];

      const result = await engine.assemble({
        sessionId: "agent:abc:mainKey",
        messages,
        tokenBudget: 2000,
      });

      expect(result.messages).toBe(messages);
      expect(result.systemPromptAddition).toContain("<sonzai-context>");
      expect(result.systemPromptAddition).toContain("User likes coffee");
      expect(result.estimatedTokens).toBeGreaterThan(0);

      // Verify the single context() call on the bound Session handle —
      // identity is pre-filled so only query-side params are passed.
      expect((client as any).mockSession.context).toHaveBeenCalledOnce();
      expect((client as any).mockSession.context).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "owner",
          query: "Tell me about coffee",
        }),
      );
    });

    it("degrades gracefully when API calls fail", async () => {
      (client as any).mockSession.context.mockRejectedValue(new Error("timeout"));

      await engine.bootstrap({ sessionId: "agent:abc:mainKey" });

      const messages = [{ role: "user", content: "hello" }];
      const result = await engine.assemble({
        sessionId: "agent:abc:mainKey",
        messages,
        tokenBudget: 2000,
      });

      // Should return pass-through with no context
      expect(result.messages).toBe(messages);
    });
  });

  describe("compact", () => {
    it("triggers consolidation", async () => {
      await engine.bootstrap({ sessionId: "agent:abc:mainKey" });
      const result = await engine.compact({
        sessionId: "agent:abc:mainKey",
        force: false,
      });

      expect(result).toEqual({ ok: true, compacted: true });
      expect((client as any).agents.consolidate).toHaveBeenCalledWith(
        "agent-123",
        { period: "daily" },
      );
    });

    it("returns failure for unknown session", async () => {
      const result = await engine.compact({
        sessionId: "unknown",
        force: false,
      });
      expect(result).toEqual({ ok: false, compacted: false });
    });
  });

  describe("afterTurn", () => {
    it("calls session.turn() with new messages", async () => {
      await engine.bootstrap({ sessionId: "agent:abc:mainKey" });

      // Simulate an assemble call first (which sets lastMessages)
      const messages = [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi there" },
      ];
      await engine.assemble({
        sessionId: "agent:abc:mainKey",
        messages,
        tokenBudget: 2000,
      });

      (client as any).mockSession.turn.mockClear();

      await engine.afterTurn({ sessionId: "agent:abc:mainKey" });

      // Identity is on the handle; only messages + provider/model
      // overrides go on the call body.
      expect((client as any).mockSession.turn).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: "user", content: "hello" },
            { role: "assistant", content: "hi there" },
          ],
        }),
      );
    });

    it("does not call session.turn when no new messages", async () => {
      await engine.bootstrap({ sessionId: "agent:abc:mainKey" });
      (client as any).mockSession.turn.mockClear();

      // afterTurn without any assemble (no messages)
      await engine.afterTurn({ sessionId: "agent:abc:mainKey" });

      expect((client as any).mockSession.turn).not.toHaveBeenCalled();
    });
  });

  describe("dispose", () => {
    it("ends all active sessions and clears state", async () => {
      await engine.bootstrap({ sessionId: "agent:abc:mainKey" });
      (client as any).mockSession.end.mockClear();

      await engine.dispose();

      expect((client as any).mockSession.end).toHaveBeenCalledTimes(1);
    });
  });
});

describe("SonzaiContextEngine.assemble", () => {
  it("skips context fetch on the session-reset boilerplate prompt", async () => {
    const sessionContext = vi.fn();
    const sessionHandle = {
      success: true,
      context: sessionContext,
      turn: vi.fn().mockResolvedValue({ success: true, extraction_id: "x", extraction_status: "queued" }),
      status: vi.fn(),
      end: vi.fn().mockResolvedValue({ success: true }),
    };
    const mockClient = {
      agents: {
        sessions: { start: vi.fn().mockResolvedValue(sessionHandle) },
        updateCapabilities: vi.fn().mockResolvedValue({}),
      },
    } as unknown as import("@sonzai-labs/agents").Sonzai;

    const engine = new SonzaiContextEngine(mockClient, {
      apiKey: "sk-test",
      agentId: "agent-1",
      baseUrl: "https://api.sonz.ai",
      agentName: "test",
      defaultUserId: "owner",
      contextTokenBudget: 2000,
      disable: {},
      extractionProvider: undefined,
      extractionModel: undefined,
      memoryMode: "sync",
    });

    await engine.bootstrap({ sessionId: "agent:agent-1:main" });

    const result = await engine.assemble({
      sessionId: "agent:agent-1:main",
      messages: [{ role: "user", content: BARE_SESSION_RESET_PROMPT }],
      tokenBudget: 4000,
    });

    expect(sessionContext).not.toHaveBeenCalled();
    expect(result.estimatedTokens).toBe(0);
    expect(result.systemPromptAddition).toBeUndefined();
  });
});

describe("SonzaiContextEngine.afterTurn pollution guard", () => {
  it("strips our own injected context from user messages before fact extraction", async () => {
    const turn = vi.fn().mockResolvedValue({ success: true, extraction_id: "x", extraction_status: "queued" });
    const sessionHandle = {
      success: true,
      context: vi.fn().mockResolvedValue({}),
      turn,
      status: vi.fn(),
      end: vi.fn().mockResolvedValue({ success: true }),
    };
    const mockClient = {
      agents: {
        sessions: { start: vi.fn().mockResolvedValue(sessionHandle) },
        updateCapabilities: vi.fn().mockResolvedValue({}),
      },
    } as unknown as import("@sonzai-labs/agents").Sonzai;

    const engine = new SonzaiContextEngine(mockClient, {
      apiKey: "sk-test",
      agentId: "agent-1",
      baseUrl: "https://api.sonz.ai",
      agentName: "test",
      defaultUserId: "owner",
      contextTokenBudget: 2000,
      disable: {},
      extractionProvider: undefined,
      extractionModel: undefined,
      memoryMode: "sync",
    });

    await engine.bootstrap({ sessionId: "agent:agent-1:main" });

    const pollutedUserMsg =
      `<sonzai-context>\n## Memories\n- user likes tea\n</sonzai-context>\n${CONTEXT_BOUNDARY}\nWhat do I like?`;

    await engine.assemble({
      sessionId: "agent:agent-1:main",
      messages: [{ role: "user", content: pollutedUserMsg }],
      tokenBudget: 4000,
    }).catch(() => {});

    await engine.afterTurn({ sessionId: "agent:agent-1:main" });

    expect(turn).toHaveBeenCalledOnce();
    // session.turn() takes a single options object — payload.messages
    // is on arg 0 (no agentId prefix like the legacy .process(agentId, opts)).
    const [payload] = turn.mock.calls[0]!;
    expect(payload.messages[0].content).toBe("What do I like?");
    expect(payload.messages[0].content).not.toContain("sonzai-context");
  });
});
