import { describe, it, expect, vi, beforeEach } from "vitest";
import { SonzaiContextEngine } from "../src/engine.js";
import type { ResolvedConfig } from "../src/config.js";

// ---------------------------------------------------------------------------
// Mock Sonzai client
// ---------------------------------------------------------------------------

function createMockClient() {
  return {
    agents: {
      create: vi.fn().mockResolvedValue({ agent_id: "agent-123", name: "test-agent" }),
      sessions: {
        start: vi.fn().mockResolvedValue({ session_id: "sess-1" }),
        end: vi.fn().mockResolvedValue({ session_id: "sess-1" }),
      },
      getContext: vi.fn().mockResolvedValue({
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
      consolidate: vi.fn().mockResolvedValue({}),
      process: vi.fn().mockResolvedValue({ success: true, memories_created: 2, facts_extracted: 3, side_effects: { mood_updated: true, personality_updated: false, habits_observed: 0, interests_detected: 1 } }),
    },
  } as unknown;
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
      expect((client as any).agents.create).toHaveBeenCalledWith({
        name: "test-agent",
      });
    });

    it("does not throw on failure (graceful degradation)", async () => {
      (client as any).agents.sessions.start.mockRejectedValue(new Error("API down"));

      await expect(
        engine.bootstrap({ sessionId: "agent:abc:mainKey" }),
      ).resolves.not.toThrow();
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

      // Verify single getContext call was made (replaces 7 individual calls)
      expect((client as any).agents.getContext).toHaveBeenCalledOnce();
      expect((client as any).agents.getContext).toHaveBeenCalledWith(
        "agent-123",
        expect.objectContaining({
          userId: "owner",
          query: "Tell me about coffee",
        }),
      );
    });

    it("degrades gracefully when API calls fail", async () => {
      (client as any).agents.getContext.mockRejectedValue(new Error("timeout"));

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
      expect((client as any).agents.consolidate).toHaveBeenCalledWith("agent-123");
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
    it("calls process() with new messages", async () => {
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

      (client as any).agents.process.mockClear();

      await engine.afterTurn({ sessionId: "agent:abc:mainKey" });

      expect((client as any).agents.process).toHaveBeenCalledWith(
        "agent-123",
        expect.objectContaining({
          userId: "owner",
          sessionId: "agent:abc:mainKey",
          messages: [
            { role: "user", content: "hello" },
            { role: "assistant", content: "hi there" },
          ],
        }),
      );
    });

    it("does not call process when no new messages", async () => {
      await engine.bootstrap({ sessionId: "agent:abc:mainKey" });
      (client as any).agents.process.mockClear();

      // afterTurn without any assemble (no messages)
      await engine.afterTurn({ sessionId: "agent:abc:mainKey" });

      expect((client as any).agents.process).not.toHaveBeenCalled();
    });
  });

  describe("dispose", () => {
    it("ends all active sessions and clears state", async () => {
      await engine.bootstrap({ sessionId: "agent:abc:mainKey" });
      (client as any).agents.sessions.end.mockClear();

      await engine.dispose();

      expect((client as any).agents.sessions.end).toHaveBeenCalledTimes(1);
    });
  });
});
