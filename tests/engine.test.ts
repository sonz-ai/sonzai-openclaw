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
      memory: {
        search: vi.fn().mockResolvedValue({
          results: [
            { fact_id: "f1", content: "User likes coffee", fact_type: "preference", score: 0.9 },
          ],
        }),
      },
      personality: {
        get: vi.fn().mockResolvedValue({
          profile: {
            agent_id: "agent-123",
            name: "TestAgent",
            gender: "neutral",
            bio: "A test agent",
            avatar_url: "",
            personality_prompt: "",
            speech_patterns: [],
            true_interests: [],
            true_dislikes: [],
            primary_traits: ["helpful"],
            temperature: 0.7,
            big5: {
              openness: { score: 70, percentile: 70 },
              conscientiousness: { score: 60, percentile: 60 },
              extraversion: { score: 50, percentile: 50 },
              agreeableness: { score: 80, percentile: 80 },
              neuroticism: { score: 30, percentile: 30 },
            },
            dimensions: { warmth: 8, energy: 6, openness: 7, emotional_depth: 7, playfulness: 5, supportiveness: 8, curiosity: 7, wisdom: 6 },
            preferences: { pace: "moderate", formality: "casual", humor_style: "warm", emotional_expression: "moderate" },
            behaviors: { proactivity: "moderate", reliability: "high", humor: "warm" },
          },
          evolution: [],
        }),
      },
      getMood: vi.fn().mockResolvedValue({ happiness: 7, energy: 6 }),
      getRelationships: vi.fn().mockResolvedValue({ closeness: 0.5 }),
      getGoals: vi.fn().mockResolvedValue({ goals: [] }),
      getInterests: vi.fn().mockResolvedValue({ photography: "high" }),
      getHabits: vi.fn().mockResolvedValue({ meditation: "daily" }),
      consolidate: vi.fn().mockResolvedValue({}),
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

      // Name includes the OpenClaw agent segment for uniqueness across instances
      expect((client as any).agents.create).toHaveBeenCalledWith({
        name: "test-agent-abc",
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

      // Verify parallel fetches were made
      expect((client as any).agents.memory.search).toHaveBeenCalled();
      expect((client as any).agents.getMood).toHaveBeenCalled();
      expect((client as any).agents.personality.get).toHaveBeenCalled();
      expect((client as any).agents.getRelationships).toHaveBeenCalled();
      expect((client as any).agents.getGoals).toHaveBeenCalled();
    });

    it("skips disabled context sources", async () => {
      engine = new SonzaiContextEngine(
        client as any,
        createConfig({ disable: { mood: true, habits: true, interests: true } }),
      );

      await engine.bootstrap({ sessionId: "agent:abc:mainKey" });
      await engine.assemble({
        sessionId: "agent:abc:mainKey",
        messages: [{ role: "user", content: "hello" }],
        tokenBudget: 2000,
      });

      expect((client as any).agents.getMood).not.toHaveBeenCalled();
      expect((client as any).agents.getHabits).not.toHaveBeenCalled();
      expect((client as any).agents.getInterests).not.toHaveBeenCalled();
      // These should still be called
      expect((client as any).agents.memory.search).toHaveBeenCalled();
      expect((client as any).agents.personality.get).toHaveBeenCalled();
    });

    it("degrades gracefully when API calls fail", async () => {
      (client as any).agents.memory.search.mockRejectedValue(new Error("timeout"));
      (client as any).agents.getMood.mockRejectedValue(new Error("timeout"));
      (client as any).agents.personality.get.mockRejectedValue(new Error("timeout"));
      (client as any).agents.getRelationships.mockRejectedValue(new Error("timeout"));
      (client as any).agents.getGoals.mockRejectedValue(new Error("timeout"));
      (client as any).agents.getInterests.mockRejectedValue(new Error("timeout"));
      (client as any).agents.getHabits.mockRejectedValue(new Error("timeout"));

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
    it("sends new messages to sessions.end", async () => {
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

      // Reset the end mock after bootstrap
      (client as any).agents.sessions.end.mockClear();

      await engine.afterTurn({ sessionId: "agent:abc:mainKey" });

      expect((client as any).agents.sessions.end).toHaveBeenCalledWith(
        "agent-123",
        expect.objectContaining({
          userId: "owner",
          sessionId: "agent:abc:mainKey",
          totalMessages: 1,
          messages: [
            { role: "user", content: "hello" },
            { role: "assistant", content: "hi there" },
          ],
        }),
      );
    });

    it("does not call sessions.end when no new messages", async () => {
      await engine.bootstrap({ sessionId: "agent:abc:mainKey" });
      (client as any).agents.sessions.end.mockClear();

      // afterTurn without any assemble (no messages)
      await engine.afterTurn({ sessionId: "agent:abc:mainKey" });

      expect((client as any).agents.sessions.end).not.toHaveBeenCalled();
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
