/**
 * Transforms Sonzai API responses into a formatted systemPromptAddition
 * string for OpenClaw context injection.
 */

import type {
  EnrichedContextResponse,
  GoalsResponse,
  HabitsResponse,
  InterestsResponse,
  MemorySearchResponse,
  MoodResponse,
  PersonalityResponse,
  RelationshipResponse,
} from "@sonzai-labs/agents";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface ContextSources {
  personality?: PersonalityResponse;
  mood?: MoodResponse;
  relationships?: RelationshipResponse;
  memories?: MemorySearchResponse;
  goals?: GoalsResponse;
  interests?: InterestsResponse;
  habits?: HabitsResponse;
}

/**
 * Sections in priority order (lowest priority first — dropped first on truncation).
 */
const SECTION_ORDER: (keyof ContextSources)[] = [
  "habits",
  "interests",
  "goals",
  "relationships",
  "mood",
  "memories",
  "personality",
];

type SectionFormatter = (data: unknown) => string | null;

const formatters: Record<keyof ContextSources, SectionFormatter> = {
  personality: formatPersonality,
  mood: formatMood,
  relationships: formatRelationships,
  memories: formatMemories,
  goals: formatGoals,
  interests: formatInterests,
  habits: formatHabits,
};

/**
 * Build the systemPromptAddition from all available context sources.
 * Returns an empty string if no data is available.
 */
export function buildSystemPromptAddition(
  sources: ContextSources,
  tokenBudget: number,
): string {
  // Build sections in priority order (highest priority first for display)
  const sections: { key: keyof ContextSources; text: string }[] = [];

  for (const key of [...SECTION_ORDER].reverse()) {
    const data = sources[key];
    if (!data) continue;
    const text = formatters[key](data);
    if (text) sections.push({ key, text });
  }

  if (sections.length === 0) return "";

  // Assemble full output
  let result = "<sonzai-context>\n" + sections.map((s) => s.text).join("\n\n") + "\n</sonzai-context>";

  // Truncate lowest-priority sections until within budget
  while (estimateTokens(result) > tokenBudget && sections.length > 1) {
    // Remove the last section (lowest priority in display order = highest index corresponds to lowest priority)
    const dropKey = SECTION_ORDER.find((k) =>
      sections.some((s) => s.key === k),
    );
    if (!dropKey) break;
    const idx = sections.findIndex((s) => s.key === dropKey);
    if (idx === -1) break;
    sections.splice(idx, 1);
    result = "<sonzai-context>\n" + sections.map((s) => s.text).join("\n\n") + "\n</sonzai-context>";
  }

  // Final hard truncation if single section is still too long
  if (estimateTokens(result) > tokenBudget) {
    const maxChars = tokenBudget * 4;
    result = result.slice(0, maxChars) + "\n[...truncated]\n</sonzai-context>";
  }

  return result;
}

/**
 * Rough token estimate: ~4 chars per token, erring on overestimation.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Section formatters
// ---------------------------------------------------------------------------

function formatPersonality(data: unknown): string | null {
  const resp = data as PersonalityResponse;
  const p = resp?.profile;
  if (!p) return null;

  const lines = ["## Personality"];
  lines.push(`Name: ${p.name}`);
  if (p.bio) lines.push(`Bio: ${p.bio}`);
  if (p.primary_traits?.length) lines.push(`Traits: ${p.primary_traits.join(", ")}`);
  if (p.speech_patterns?.length) lines.push(`Speech patterns: ${p.speech_patterns.join(", ")}`);
  if (p.personality_prompt) lines.push(`Character: ${p.personality_prompt}`);

  if (p.big5) {
    const b5 = p.big5;
    const traits = [
      `O:${b5.openness?.score ?? "?"}`,
      `C:${b5.conscientiousness?.score ?? "?"}`,
      `E:${b5.extraversion?.score ?? "?"}`,
      `A:${b5.agreeableness?.score ?? "?"}`,
      `N:${b5.neuroticism?.score ?? "?"}`,
    ];
    lines.push(`Big5: ${traits.join(" ")}`);
  }

  if (p.preferences) {
    const pref = p.preferences;
    lines.push(
      `Style: pace=${pref.pace}, formality=${pref.formality}, humor=${pref.humor_style}, expression=${pref.emotional_expression}`,
    );
  }

  // Recent evolution
  const evo = resp?.evolution;
  if (evo?.length) {
    lines.push("Recent shifts:");
    for (const d of evo.slice(0, 3)) {
      lines.push(`- ${d.change} (${d.reason})`);
    }
  }

  return lines.join("\n");
}

function formatMood(data: unknown): string | null {
  const mood = data as Record<string, unknown>;
  if (!mood || Object.keys(mood).length === 0) return null;

  const lines = ["## Current Mood"];

  // The mood response shape varies — extract known fields robustly
  for (const [key, value] of Object.entries(mood)) {
    if (key.startsWith("_") || value === null || value === undefined) continue;
    if (typeof value === "object") {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

function formatRelationships(data: unknown): string | null {
  const rels = data as Record<string, unknown>;
  if (!rels || Object.keys(rels).length === 0) return null;

  const lines = ["## Relationship"];
  for (const [key, value] of Object.entries(rels)) {
    if (key.startsWith("_") || value === null || value === undefined) continue;
    if (typeof value === "object") {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

function formatMemories(data: unknown): string | null {
  const resp = data as MemorySearchResponse;
  if (!resp?.results?.length) return null;

  const lines = ["## Relevant Memories"];
  for (const mem of resp.results.slice(0, 10)) {
    const score = mem.score ? ` (score: ${mem.score.toFixed(2)})` : "";
    lines.push(`- ${mem.content}${score}`);
  }

  return lines.join("\n");
}

function formatGoals(data: unknown): string | null {
  const resp = data as GoalsResponse;
  if (!resp?.goals?.length) return null;

  const lines = ["## Goals"];
  for (const g of resp.goals.filter((g) => g.status === "active").slice(0, 5)) {
    lines.push(`- ${g.title}: ${g.description} [${g.type}, priority=${g.priority}]`);
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

function formatInterests(data: unknown): string | null {
  const interests = data as Record<string, unknown>;
  if (!interests || Object.keys(interests).length === 0) return null;

  const lines = ["## Interests"];
  for (const [key, value] of Object.entries(interests)) {
    if (key.startsWith("_") || value === null || value === undefined) continue;
    if (typeof value === "object") {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

function formatHabits(data: unknown): string | null {
  const habits = data as Record<string, unknown>;
  if (!habits || Object.keys(habits).length === 0) return null;

  const lines = ["## Habits"];
  for (const [key, value] of Object.entries(habits)) {
    if (key.startsWith("_") || value === null || value === undefined) continue;
    if (typeof value === "object") {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

// ---------------------------------------------------------------------------
// Single-call context builder (from EnrichedContextResponse)
// ---------------------------------------------------------------------------

interface DisableConfig {
  personality?: boolean;
  mood?: boolean;
  relationships?: boolean;
  memory?: boolean;
  goals?: boolean;
  interests?: boolean;
  habits?: boolean;
  knowledge?: boolean;
}

/**
 * Build the systemPromptAddition from a single EnrichedContextResponse
 * (returned by GET /agents/{id}/context). Single network call replaces 7.
 */
export function buildSystemPromptFromContext(
  ctx: EnrichedContextResponse,
  tokenBudget: number,
  disable: DisableConfig = {},
): string {
  const sections: { key: string; text: string; priority: number }[] = [];

  // Always inject current date/time and timezone (priority 10 — never truncated).
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date();
  const dateTimeStr = now.toLocaleString("en-US", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
  sections.push({
    key: "time",
    text: `## Current Time\n${dateTimeStr} (${timezone})`,
    priority: 10,
  });

  if (!disable.knowledge) {
    const kb = ctx.knowledge as { results?: Array<{ content: string; label?: string; type?: string; source?: string; score?: number }> } | undefined;
    if (kb?.results?.length) {
      const lines = ["## Knowledge Base"];
      for (const r of kb.results) {
        const header = r.label || "Reference";
        const source = r.source ? ` [source: ${r.source}]` : "";
        lines.push(`### ${header}${source}`);
        lines.push(r.content);
      }
      sections.push({ key: "knowledge", text: lines.join("\n"), priority: 8 });
    }
  }

  if (!disable.personality && ctx.personality_prompt) {
    const lines = ["## Personality"];
    lines.push(`Character: ${ctx.personality_prompt}`);
    if (ctx.primary_traits?.length) lines.push(`Traits: ${ctx.primary_traits.join(", ")}`);
    if (ctx.speech_patterns?.length) lines.push(`Speech patterns: ${ctx.speech_patterns.join(", ")}`);
    if (ctx.big5) {
      const b5 = ctx.big5 as Record<string, Record<string, number>>;
      const traits = ["openness", "conscientiousness", "extraversion", "agreeableness", "neuroticism"]
        .map((t) => `${t[0]!.toUpperCase()}:${b5[t]?.score ?? "?"}`)
        .join(" ");
      lines.push(`Big5: ${traits}`);
    }
    sections.push({ key: "personality", text: lines.join("\n"), priority: 7 });
  }

  if (!disable.memory) {
    const facts = ctx.loaded_facts;
    if (facts?.length) {
      const lines = ["## Relevant Memories"];
      for (const f of facts.slice(0, 10)) {
        const text = (f.atomic_text as string) || (f.content as string) || JSON.stringify(f);
        lines.push(`- ${text}`);
      }
      sections.push({ key: "memories", text: lines.join("\n"), priority: 6 });
    }
  }

  if (!disable.mood && ctx.current_mood) {
    const mood = ctx.current_mood;
    const lines = ["## Current Mood"];
    for (const [key, value] of Object.entries(mood)) {
      if (key.startsWith("_") || value === null || value === undefined) continue;
      lines.push(`${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`);
    }
    if (lines.length > 1) sections.push({ key: "mood", text: lines.join("\n"), priority: 5 });
  }

  if (!disable.relationships && ctx.relationship_narrative) {
    const lines = ["## Relationship"];
    lines.push(ctx.relationship_narrative);
    if (ctx.love_from_agent !== undefined) lines.push(`Love (agent->user): ${ctx.love_from_agent}`);
    if (ctx.love_from_user !== undefined) lines.push(`Love (user->agent): ${ctx.love_from_user}`);
    if (ctx.relationship_status) lines.push(`Status: ${ctx.relationship_status}`);
    sections.push({ key: "relationships", text: lines.join("\n"), priority: 4 });
  }

  if (!disable.goals) {
    const goals = ctx.active_goals as Array<Record<string, unknown>> | undefined;
    if (goals?.length) {
      const lines = ["## Goals"];
      for (const g of goals.slice(0, 5)) {
        lines.push(`- ${g.title}: ${g.description} [${g.type}]`);
      }
      sections.push({ key: "goals", text: lines.join("\n"), priority: 3 });
    }
  }

  if (!disable.interests && ctx.true_interests?.length) {
    sections.push({ key: "interests", text: `## Interests\n${ctx.true_interests.join(", ")}`, priority: 2 });
  }

  if (!disable.habits) {
    const ctxHabits = ctx.habits as Array<Record<string, unknown>> | undefined;
    if (ctxHabits?.length) {
      const lines = ["## Habits"];
      for (const h of ctxHabits.slice(0, 5)) {
        lines.push(`- ${h.name}: ${h.description || h.category || ""}`);
      }
      sections.push({ key: "habits", text: lines.join("\n"), priority: 1 });
    }
  }

  if (sections.length === 0) return "";

  sections.sort((a, b) => b.priority - a.priority);
  let result = "<sonzai-context>\n" + sections.map((s) => s.text).join("\n\n") + "\n</sonzai-context>";

  while (estimateTokens(result) > tokenBudget && sections.length > 1) {
    sections.pop();
    result = "<sonzai-context>\n" + sections.map((s) => s.text).join("\n\n") + "\n</sonzai-context>";
  }

  if (estimateTokens(result) > tokenBudget) {
    const maxChars = tokenBudget * 4;
    result = result.slice(0, maxChars) + "\n[...truncated]\n</sonzai-context>";
  }

  return result;
}
