import { describe, it, expect } from "vitest";
import {
  buildSystemPromptAddition,
  estimateTokens,
} from "../src/context-builder.js";
import type { ContextSources } from "../src/context-builder.js";

describe("estimateTokens", () => {
  it("estimates ~4 chars per token", () => {
    expect(estimateTokens("a".repeat(100))).toBe(25);
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("hello")).toBe(2); // ceil(5/4)
  });
});

describe("buildSystemPromptAddition", () => {
  it("returns empty string when no sources provided", () => {
    expect(buildSystemPromptAddition({}, 2000)).toBe("");
  });

  it("returns empty string when all sources are undefined", () => {
    const sources: ContextSources = {
      personality: undefined,
      mood: undefined,
      memories: undefined,
    };
    expect(buildSystemPromptAddition(sources, 2000)).toBe("");
  });

  it("includes personality section", () => {
    const sources: ContextSources = {
      personality: {
        profile: {
          agent_id: "a1",
          name: "Luna",
          gender: "female",
          bio: "A curious soul",
          avatar_url: "",
          personality_prompt: "You are Luna",
          speech_patterns: ["uses metaphors"],
          true_interests: [],
          true_dislikes: [],
          primary_traits: ["curious", "empathetic"],
          temperature: 0.7,
          big5: {
            openness: { score: 80, percentile: 85 },
            conscientiousness: { score: 60, percentile: 55 },
            extraversion: { score: 70, percentile: 65 },
            agreeableness: { score: 75, percentile: 70 },
            neuroticism: { score: 30, percentile: 25 },
          },
          dimensions: {
            intellect: 9,
            aesthetic: 7,
            industriousness: 6,
            orderliness: 5,
            enthusiasm: 7,
            assertiveness: 6,
            compassion: 9,
            politeness: 8,
            withdrawal: 3,
            volatility: 2,
          },
          preferences: {
            conversation_pace: "moderate",
            formality: "casual",
            humor_style: "warm",
            emotional_expression: "expressive",
          },
          behaviors: {
            response_length: "moderate",
            question_frequency: "high",
            empathy_style: "warm",
            conflict_approach: "collaborative",
          },
          emotional_tendencies: {},
        },
        evolution: [],
      },
    };
    const result = buildSystemPromptAddition(sources, 2000);
    expect(result).toContain("<sonzai-context>");
    expect(result).toContain("## Personality");
    expect(result).toContain("Luna");
    expect(result).toContain("curious, empathetic");
    expect(result).toContain("Big5:");
    expect(result).toContain("</sonzai-context>");
  });

  it("includes memories section", () => {
    const sources: ContextSources = {
      memories: {
        results: [
          { fact_id: "f1", content: "User loves hiking", fact_type: "preference", score: 0.92 },
          { fact_id: "f2", content: "User has a dog named Max", fact_type: "fact", score: 0.85 },
        ],
      },
    };
    const result = buildSystemPromptAddition(sources, 2000);
    expect(result).toContain("## Relevant Memories");
    expect(result).toContain("User loves hiking");
    expect(result).toContain("score: 0.92");
  });

  it("includes goals section with only active goals", () => {
    const sources: ContextSources = {
      goals: {
        goals: [
          {
            goal_id: "g1",
            agent_id: "a1",
            type: "learning_discovery",
            title: "Learn photography",
            description: "Explore photography techniques",
            priority: 1,
            status: "active",
            created_at: "2026-01-01",
            updated_at: "2026-01-01",
          },
          {
            goal_id: "g2",
            agent_id: "a1",
            type: "personal_growth",
            title: "Old goal",
            description: "Already done",
            priority: 0,
            status: "achieved",
            created_at: "2025-12-01",
            updated_at: "2025-12-15",
          },
        ],
      },
    };
    const result = buildSystemPromptAddition(sources, 2000);
    expect(result).toContain("Learn photography");
    expect(result).not.toContain("Old goal");
  });

  it("truncates sections when over token budget", () => {
    const sources: ContextSources = {
      personality: {
        profile: {
          agent_id: "a1",
          name: "Luna",
          gender: "female",
          bio: "A very long bio ".repeat(50),
          avatar_url: "",
          personality_prompt: "Long prompt ".repeat(50),
          speech_patterns: ["pattern1", "pattern2"],
          true_interests: [],
          true_dislikes: [],
          primary_traits: ["trait1", "trait2"],
          temperature: 0.7,
          big5: {
            openness: { score: 80, percentile: 85 },
            conscientiousness: { score: 60, percentile: 55 },
            extraversion: { score: 70, percentile: 65 },
            agreeableness: { score: 75, percentile: 70 },
            neuroticism: { score: 30, percentile: 25 },
          },
          dimensions: {
            intellect: 9, aesthetic: 7, industriousness: 6, orderliness: 5,
            enthusiasm: 7, assertiveness: 6, compassion: 9, politeness: 8,
            withdrawal: 3, volatility: 2,
          },
          preferences: { conversation_pace: "moderate", formality: "casual", humor_style: "warm", emotional_expression: "expressive" },
          behaviors: { response_length: "moderate", question_frequency: "high", empathy_style: "warm", conflict_approach: "collaborative" },
          emotional_tendencies: {},
        },
        evolution: [],
      },
      habits: { some_habit: "daily meditation" },
      interests: { photography: "high", cooking: "medium" },
    };

    // Very small budget — should drop lower-priority sections
    const result = buildSystemPromptAddition(sources, 100);
    // Personality should survive (highest priority), habits/interests should be dropped
    expect(result).toContain("Personality");
  });
});
