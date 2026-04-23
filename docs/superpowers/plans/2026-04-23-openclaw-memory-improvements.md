# OpenClaw Plugin Memory & Onboarding Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close four gaps in the `@sonzai-labs/openclaw-context` plugin: skip wasted work on OpenClaw's session-reset boilerplate, prevent injected context from polluting saved memory, add an agent-installable SKILL.md, and empirically verify whether mid-session memory is actually fresh (gating a follow-up backend plan).

**Architecture:** All four items live entirely in the `sonzai-openclaw` repo and require no backend changes. Three are pure plugin code/docs; the fourth is a reproducible investigation script whose output decides whether a separate backend plan is needed. Changes follow the existing patterns: ESM with `.js` imports, vitest tests in `tests/*.test.ts`, single-responsibility files under `src/`.

**Tech Stack:** TypeScript (strict, ESM), vitest, tsup, biome. Runtime deps: `@sonzai-labs/agents` ^1.4.0, Node >=18.

---

## Preflight

- [ ] **Step 0: Create a working branch**

```bash
cd /Volumes/CORSAIR/code/sonzai/sonzai-openclaw
git checkout -b feat/memory-improvements
```

- [ ] **Step 0b: Confirm baseline tests pass**

```bash
cd /Volumes/CORSAIR/code/sonzai/sonzai-openclaw
bun install
bun run test
```

Expected: all existing tests pass. If any fail, stop — do not build on a red baseline.

---

## File Structure

Files created by this plan:

| Path | Responsibility |
|------|----------------|
| `src/session-reset.ts` | Detect OpenClaw's session-reset boilerplate prompt (port of EverOS's Levenshtein-based matcher) |
| `src/strip-context.ts` | Strip injected `<sonzai-context>` block from user messages before they're sent to fact extraction |
| `tests/session-reset.test.ts` | Unit tests for `isSessionResetPrompt` |
| `tests/strip-context.test.ts` | Unit tests for `stripInjectedContext` |
| `SKILL.md` | Agent-installable skill manifest (trigger phrases, onboarding steps, handoff template) |
| `scripts/verify-mid-session-memory.sh` | Reproducible investigation script — establishes whether `getContext.loaded_facts` refreshes mid-session |
| `docs/findings/2026-04-23-mid-session-memory.md` | Output of the investigation — the document that gates the follow-up backend plan |

Files modified:

| Path | Change |
|------|--------|
| `src/context-builder.ts` | Export `CONTEXT_BOUNDARY` constant; append it to `buildSystemPromptFromContext` output |
| `src/engine.ts` | `assemble()` — early-return on session-reset prompt. `afterTurn()` — strip injected context from user messages before `agents.process()`. |
| `package.json` | Bump to `1.2.0`; add `SKILL.md` to `files` array |

---

## Task 1: Session-Reset Prompt Filter

**Why:** OpenClaw fires a ~400-character boilerplate prompt at the start of every `/new` or `/reset` session. Our `assemble()` currently sends this as the memory search query, which wastes a network call and returns irrelevant hits that pollute the first real turn's context.

**Files:**
- Create: `src/session-reset.ts`
- Create: `tests/session-reset.test.ts`
- Modify: `src/engine.ts` (import + early-return in `assemble`)

- [ ] **Step 1.1: Write the failing test**

Create `tests/session-reset.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  BARE_SESSION_RESET_PROMPT,
  isSessionResetPrompt,
} from "../src/session-reset.js";

describe("isSessionResetPrompt", () => {
  it("returns false for undefined", () => {
    expect(isSessionResetPrompt(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isSessionResetPrompt("")).toBe(false);
  });

  it("returns true for the exact boilerplate prompt", () => {
    expect(isSessionResetPrompt(BARE_SESSION_RESET_PROMPT)).toBe(true);
  });

  it("returns true for minor variation within 20% edit distance", () => {
    // Remove one clause — still >80% similar to the canonical prompt.
    const variant = BARE_SESSION_RESET_PROMPT.replace(
      "If the runtime model differs from default_model in the system prompt, mention the default model. ",
      "",
    );
    expect(isSessionResetPrompt(variant)).toBe(true);
  });

  it("returns false for normal user messages", () => {
    expect(isSessionResetPrompt("Hello, how are you?")).toBe(false);
    expect(isSessionResetPrompt("What coffee do I like?")).toBe(false);
    expect(isSessionResetPrompt("Remember: I prefer dark mode.")).toBe(false);
  });

  it("returns false when length differs by more than 20%", () => {
    expect(isSessionResetPrompt("short")).toBe(false);
    expect(isSessionResetPrompt("x".repeat(2000))).toBe(false);
  });

  it("returns false for prompts that share some words but are unrelated", () => {
    const unrelated =
      "A new session of our planning meeting was started - please read the agenda " +
      "and summarize the action items for the team. Keep it brief and mention blockers.";
    expect(isSessionResetPrompt(unrelated)).toBe(false);
  });
});
```

- [ ] **Step 1.2: Run the test and confirm it fails**

```bash
bun run test -- tests/session-reset.test.ts
```

Expected: FAIL with module-not-found for `../src/session-reset.js`.

- [ ] **Step 1.3: Implement `src/session-reset.ts`**

Create `src/session-reset.ts`:

```ts
/**
 * Detect OpenClaw's session-reset boilerplate prompt so we can skip
 * wasted context-engine work on it. Port of the matcher used by the
 * EverOS OpenClaw plugin.
 *
 * Strategy: length check (±20%) to reject cheaply, then normalized
 * Levenshtein distance (<20%) to accept near-matches. OpenClaw can
 * tweak the prompt slightly across releases; an exact match is too
 * brittle.
 */

export const BARE_SESSION_RESET_PROMPT =
  "A new session was started via /new or /reset. Execute your Session Startup sequence now - read the required files before responding to the user. Then greet the user in your configured persona, if one is provided. Be yourself - use your defined voice, mannerisms, and mood. Keep it to 1-3 sentences and ask what they want to do. If the runtime model differs from default_model in the system prompt, mention the default model. Do not mention internal steps, files, tools, or reasoning.";

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const prev = Array.from({ length: n + 1 }, (_, i) => i);
  const curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]!
          : 1 + Math.min(prev[j - 1]!, prev[j]!, curr[j - 1]!);
    }
    prev.splice(0, n + 1, ...curr);
  }
  return prev[n]!;
}

/**
 * Returns true when `query` is within 20% length of the canonical prompt
 * AND its normalized edit distance is below 0.20 (≥80% similar).
 */
export function isSessionResetPrompt(query: string | undefined): boolean {
  if (!query) return false;
  const promptLen = BARE_SESSION_RESET_PROMPT.length;
  const queryLen = query.length;
  if (Math.abs(queryLen - promptLen) / promptLen > 0.2) return false;
  const dist = levenshtein(query, BARE_SESSION_RESET_PROMPT);
  return dist / Math.max(queryLen, promptLen) < 0.2;
}
```

- [ ] **Step 1.4: Run the test and confirm it passes**

```bash
bun run test -- tests/session-reset.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 1.5: Wire it into `engine.ts`**

Modify `src/engine.ts` — add this import alongside the other `./...js` imports at the top:

```ts
import { isSessionResetPrompt } from "./session-reset.js";
```

Then in `assemble()`, immediately after `const lastUserMsg = findLastUserMessage(messages);` and before the `try` block (around `engine.ts:101`), add:

```ts
      if (isSessionResetPrompt(lastUserMsg)) {
        return { messages, estimatedTokens: 0 };
      }
```

The full modified `assemble()` preamble becomes:

```ts
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

    session.lastMessages = messages;

    try {
      const { agentId, userId } = session;
      const lastUserMsg = findLastUserMessage(messages);

      if (isSessionResetPrompt(lastUserMsg)) {
        return { messages, estimatedTokens: 0 };
      }

      const budget = Math.min(tokenBudget, this.config.contextTokenBudget);
      // ... rest unchanged
```

- [ ] **Step 1.6: Add an engine-level integration test**

Append to `tests/engine.test.ts`. Ensure the imports at the top of the file include `vi` from vitest and add these module imports if not already present:

```ts
import { describe, it, expect, vi } from "vitest";
import { SonzaiContextEngine } from "../src/engine.js";
import { BARE_SESSION_RESET_PROMPT } from "../src/session-reset.js";
```

Then append the block:

```ts
describe("SonzaiContextEngine.assemble", () => {
  it("skips context fetch on the session-reset boilerplate prompt", async () => {
    const getContext = vi.fn();
    const mockClient = {
      agents: {
        sessions: { start: vi.fn().mockResolvedValue({}) },
        getContext,
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
    });

    await engine.bootstrap({ sessionId: "agent:agent-1:main" });

    const result = await engine.assemble({
      sessionId: "agent:agent-1:main",
      messages: [{ role: "user", content: BARE_SESSION_RESET_PROMPT }],
      tokenBudget: 4000,
    });

    expect(getContext).not.toHaveBeenCalled();
    expect(result.estimatedTokens).toBe(0);
    expect(result.systemPromptAddition).toBeUndefined();
  });
});
```


- [ ] **Step 1.7: Run all tests and confirm green**

```bash
bun run test
```

Expected: all tests pass.

- [ ] **Step 1.8: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 1.9: Commit**

```bash
git add src/session-reset.ts tests/session-reset.test.ts tests/engine.test.ts src/engine.ts
git commit -m "feat: skip context fetch on OpenClaw session-reset boilerplate

Ports the Levenshtein-based matcher from the EverOS OpenClaw plugin so
/new and /reset no longer trigger a wasted memory search that returns
boilerplate-adjacent hits instead of anything useful."
```

---

## Task 2: CONTEXT_BOUNDARY Pollution Guard

**Why:** If OpenClaw splices our `systemPromptAddition` into the user message content (some hosts do, some don't), the next turn's `afterTurn` will send our own injected `<sonzai-context>` block back to fact extraction — polluting memory with things the agent said to itself. A zero-width boundary + defensive strip is correct in both cases: load-bearing if splicing happens, harmless no-op if it doesn't.

**Files:**
- Modify: `src/context-builder.ts` (add `CONTEXT_BOUNDARY`, append to output)
- Create: `src/strip-context.ts`
- Create: `tests/strip-context.test.ts`
- Modify: `src/engine.ts` (strip user messages in `afterTurn`)

- [ ] **Step 2.1: Write the failing test for stripping**

Create `tests/strip-context.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { stripInjectedContext } from "../src/strip-context.js";
import { CONTEXT_BOUNDARY } from "../src/context-builder.js";

describe("stripInjectedContext", () => {
  it("returns content unchanged when no boundary present", () => {
    expect(stripInjectedContext("hello world")).toBe("hello world");
  });

  it("returns empty string unchanged", () => {
    expect(stripInjectedContext("")).toBe("");
  });

  it("strips everything up to and including the boundary", () => {
    const input = `<sonzai-context>\n## Personality\nName: Luna\n</sonzai-context>\n${CONTEXT_BOUNDARY}\nWhat is my favorite food?`;
    expect(stripInjectedContext(input)).toBe("What is my favorite food?");
  });

  it("strips leading whitespace after boundary", () => {
    const input = `injected${CONTEXT_BOUNDARY}   \n  actual question`;
    expect(stripInjectedContext(input)).toBe("actual question");
  });

  it("uses the last boundary when multiple present", () => {
    const input = `${CONTEXT_BOUNDARY}first turn${CONTEXT_BOUNDARY}second turn`;
    expect(stripInjectedContext(input)).toBe("second turn");
  });

  it("preserves boundary character inside legitimate content", () => {
    // If no zero-width boundary is present, normal zero-width-containing
    // text (e.g. emoji metadata) is not touched.
    const input = "I love café";
    expect(stripInjectedContext(input)).toBe("I love café");
  });
});
```

- [ ] **Step 2.2: Run and confirm it fails**

```bash
bun run test -- tests/strip-context.test.ts
```

Expected: FAIL — `CONTEXT_BOUNDARY` not exported from context-builder, `stripInjectedContext` module missing.

- [ ] **Step 2.3: Add `CONTEXT_BOUNDARY` to `context-builder.ts`**

Modify `src/context-builder.ts` — add near the top of the file, after the imports:

```ts
/**
 * Zero-width sentinel appended to every injected context block. If an
 * OpenClaw host splices `systemPromptAddition` into the user message
 * content (instead of keeping it in a system role), the next turn's
 * afterTurn can slice everything up to this sentinel before sending
 * messages to fact extraction — preventing memory from being polluted
 * by our own injected context.
 */
export const CONTEXT_BOUNDARY =
  "user​original​query​:​​​​";
```

Then in `buildSystemPromptFromContext` (around line 389), change:

```ts
  if (sections.length === 0) return "";

  sections.sort((a, b) => b.priority - a.priority);
  let result = "<sonzai-context>\n" + sections.map((s) => s.text).join("\n\n") + "\n</sonzai-context>";
```

to:

```ts
  if (sections.length === 0) return "";

  sections.sort((a, b) => b.priority - a.priority);
  let result =
    "<sonzai-context>\n" +
    sections.map((s) => s.text).join("\n\n") +
    "\n</sonzai-context>";
```

(No semantic change — just formatting.) Then at the very end of the function, before `return result;`, change the final lines:

```ts
  if (estimateTokens(result) > tokenBudget) {
    const maxChars = tokenBudget * 4;
    result = result.slice(0, maxChars) + "\n[...truncated]\n</sonzai-context>";
  }

  return result;
```

to:

```ts
  if (estimateTokens(result) > tokenBudget) {
    const maxChars = tokenBudget * 4;
    result = result.slice(0, maxChars) + "\n[...truncated]\n</sonzai-context>";
  }

  return result + "\n" + CONTEXT_BOUNDARY;
```

Do the same edit at the end of `buildSystemPromptAddition` (the legacy builder, around line 98):

```ts
  if (estimateTokens(result) > tokenBudget) {
    const maxChars = tokenBudget * 4;
    result = result.slice(0, maxChars) + "\n[...truncated]\n</sonzai-context>";
  }

  return result + "\n" + CONTEXT_BOUNDARY;
}
```

- [ ] **Step 2.4: Create `src/strip-context.ts`**

```ts
/**
 * Strip our own injected `<sonzai-context>` block from user message
 * content. See CONTEXT_BOUNDARY in context-builder.ts for rationale.
 */

import { CONTEXT_BOUNDARY } from "./context-builder.js";

export function stripInjectedContext(content: string): string {
  if (!content) return content;
  const cut = content.lastIndexOf(CONTEXT_BOUNDARY);
  if (cut < 0) return content;
  return content.slice(cut + CONTEXT_BOUNDARY.length).replace(/^\s+/, "");
}
```

- [ ] **Step 2.5: Run the strip test and confirm it passes**

```bash
bun run test -- tests/strip-context.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 2.6: Wire strip into `engine.ts` `afterTurn`**

Modify `src/engine.ts` — add the import:

```ts
import { stripInjectedContext } from "./strip-context.js";
```

Then modify `afterTurn()` (around line 161) to strip user messages. Replace:

```ts
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
```

with:

```ts
      await this.client.agents.process(session.agentId, {
        userId: session.userId,
        sessionId: session.sonzaiSessionId,
        messages: newMessages.map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.role === "user" ? stripInjectedContext(m.content) : m.content,
        })),
        provider: this.config.extractionProvider,
        model: this.config.extractionModel,
      });
```

- [ ] **Step 2.7: Add an engine-level test that the boundary is stripped**

Append to `tests/engine.test.ts`. Ensure this import is present at the top (add if missing):

```ts
import { CONTEXT_BOUNDARY } from "../src/context-builder.js";
```

Then append the block:

```ts
describe("SonzaiContextEngine.afterTurn pollution guard", () => {
  it("strips our own injected context from user messages before fact extraction", async () => {
    const process = vi.fn().mockResolvedValue({});
    const mockClient = {
      agents: {
        sessions: { start: vi.fn().mockResolvedValue({}) },
        process,
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
    });

    await engine.bootstrap({ sessionId: "agent:agent-1:main" });

    // Simulate OpenClaw splicing the context block into the user message.
    const pollutedUserMsg =
      `<sonzai-context>\n## Memories\n- user likes tea\n</sonzai-context>\n${CONTEXT_BOUNDARY}\nWhat do I like?`;

    // Prime lastMessages via a mock assemble so afterTurn sees them.
    await engine.assemble({
      sessionId: "agent:agent-1:main",
      messages: [{ role: "user", content: pollutedUserMsg }],
      tokenBudget: 4000,
    }).catch(() => {}); // getContext may not be mocked; ignore

    await engine.afterTurn({ sessionId: "agent:agent-1:main" });

    expect(process).toHaveBeenCalledOnce();
    const [, payload] = process.mock.calls[0]!;
    expect(payload.messages[0].content).toBe("What do I like?");
    expect(payload.messages[0].content).not.toContain("sonzai-context");
  });
});
```

- [ ] **Step 2.8: Run all tests and confirm green**

```bash
bun run test
```

Expected: all tests pass.

- [ ] **Step 2.9: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 2.10: Commit**

```bash
git add src/context-builder.ts src/strip-context.ts src/engine.ts \
        tests/strip-context.test.ts tests/engine.test.ts
git commit -m "feat: guard against injected-context pollution in memory

Appends a zero-width CONTEXT_BOUNDARY to every injected systemPromptAddition
block. afterTurn strips everything up to that boundary from user-role
messages before sending them to agents.process(), so OpenClaw hosts that
splice the addition into user content can't cause us to ingest our own
context as 'user said this'.

Defense-in-depth: the strip is a no-op when no boundary is present, so
hosts that keep systemPromptAddition in a separate system role are also
unaffected."
```

---

## Task 3: SKILL.md for Agent-Driven Install

**Why:** Our existing README is human-oriented docs. Agent installers (Claude Code, Cursor, etc.) look for a `SKILL.md` with YAML frontmatter, trigger phrases, and a strict Definition of Done checklist. Without it, an AI assistant asked to "install sonzai memory for openclaw" has no canonical procedure to follow and may skip the restart step or forget to verify.

**Files:**
- Create: `SKILL.md`
- Modify: `package.json` (add `SKILL.md` to `files` array)

- [ ] **Step 3.1: Create `SKILL.md`**

Write to `SKILL.md` at the repo root:

````markdown
---
name: sonzai-mind-layer
version: 1.2.0
description: |
  Install and configure the Sonzai Mind Layer OpenClaw plugin for
  persistent memory, personality evolution, mood tracking, and
  automatic fact extraction.

  Use when users say:
  - "install sonzai"
  - "setup sonzai memory"
  - "enable sonzai plugin"
  - "give openclaw persistent memory"
  - "connect openclaw to sonz.ai"
author: Sonzai Labs
keywords:
  - sonzai
  - sonz.ai
  - context engine
  - persistent memory
  - openclaw
  - mind layer
---

# Sonzai Mind Layer OpenClaw Plugin

Gives OpenClaw agents persistent memory, personality evolution, mood
tracking, relationship modeling, and automatic fact extraction —
powered by the Sonzai Mind Layer API (https://api.sonz.ai).

Important distinction:

- This is a `context-engine` plugin, not a `memory` slot plugin.
- Users do not call memory tools manually — facts are extracted automatically.
- Every turn: relevant context is injected before the reply, new turns are
  processed for fact extraction after.

---

## Trigger phrases

Use this skill when the user wants to:

- install Sonzai for OpenClaw
- set up persistent memory backed by the Sonzai Mind Layer
- connect OpenClaw to sonz.ai
- enable personality evolution, mood tracking, or relationship modeling
- give an OpenClaw agent long-term memory

---

## When to use this skill

- user wants persistent memory across OpenClaw sessions
- user wants the agent to develop personality / mood / relationship over time
- user has (or can obtain) a Sonzai API key
- cloud-based Mind Layer API is acceptable

---

## When NOT to use this skill

- user wants fully self-hosted memory with no external service
- user wants OpenClaw's default Markdown memory slot
- temporary context only for the current session
- user is troubleshooting an unrelated OpenClaw issue

---

## What the user gets

Automatic lifecycle behavior:

| Hook | Trigger | What happens |
| --- | --- | --- |
| `bootstrap()` | Session starts | Starts a Sonzai session; auto-provisions agent if needed |
| `assemble()` | Before each turn | Fetches enriched context (memory, mood, personality, goals, relationships, habits, interests) and injects as `systemPromptAddition` |
| `afterTurn()` | After each turn | Sends new messages to Sonzai for fact extraction |
| `compact()` | Compaction check | Triggers the Sonzai consolidation pipeline |
| `dispose()` | Session ends | Cleanly ends all active Sonzai sessions |

User-facing result:

- user chats naturally
- agent recalls past preferences, facts, and commitments automatically
- personality and mood evolve over time
- nothing needs to be invoked explicitly

---

## Definition of Done

This task is not complete until all of the following are true:

1. the user has a valid Sonzai API key (or one has been explicitly obtained)
2. the plugin is installed (`openclaw plugins install @sonzai-labs/openclaw-context`)
3. an agent is provisioned (auto-created or reused)
4. `~/.openclaw/openclaw.json` is configured correctly
5. OpenClaw has been restarted
6. a natural-language verification step has been offered
7. the full final handoff message (below) has been sent

---

## Onboarding

### Step 0 — Set expectations

Before changing anything, tell the user:

> OpenClaw will need a restart during setup. After restart, wait about 30
> seconds, then send a short natural-language message here so we can verify
> memory is working.

Do not skip this notice if you are about to restart OpenClaw automatically.

### Step 1 — Check / obtain API key

If the user has not mentioned a key, ask:

> Do you have a Sonzai API key? If not, get one at
> https://platform.sonz.ai → Projects → API Keys. Keys start with `sk-`.

Do not proceed without a key.

### Step 2 — Install plugin

Run:

```bash
openclaw plugins install @sonzai-labs/openclaw-context
```

Then run interactive setup:

```bash
npx @sonzai-labs/openclaw-context setup
```

The setup wizard:

- accepts an API key (or reads `SONZAI_API_KEY` from env)
- asks whether to use an existing agent or auto-provision
- writes `~/.openclaw/openclaw.json` with the plugin config

For non-interactive / CI use, use the programmatic API:

```bash
node -e 'import("@sonzai-labs/openclaw-context").then(m => m.setup({apiKey: process.env.SONZAI_API_KEY, agentName: "openclaw-agent"}))'
```

### Step 3 — Manual config fallback

If the installer is unavailable, patch `~/.openclaw/openclaw.json` manually.

Expected config shape:

```json
{
  "plugins": {
    "slots": {
      "contextEngine": "sonzai"
    },
    "entries": {
      "sonzai": {
        "enabled": true,
        "apiKey": "sk-...",
        "agentId": "optional-existing-uuid"
      }
    }
  }
}
```

Merge-safe patch (replace `<api-key>` with the real key):

```bash
jq --arg key '<api-key>' '
  .plugins = (.plugins // {}) |
  .plugins.slots = (.plugins.slots // {}) |
  .plugins.slots.contextEngine = "sonzai" |
  .plugins.entries = (.plugins.entries // {}) |
  .plugins.entries.sonzai.enabled = true |
  .plugins.entries.sonzai.apiKey = $key
' ~/.openclaw/openclaw.json > /tmp/openclaw.json.tmp && mv /tmp/openclaw.json.tmp ~/.openclaw/openclaw.json
```

### Step 4 — Restart OpenClaw

Immediately before restart, tell the user:

> Sonzai is installed. I am restarting OpenClaw now. After about 30
> seconds, send a short message so we can verify memory recall.

Run:

```bash
openclaw gateway restart
```

### Step 5 — Verify

Backend reachability:

```bash
curl -sf https://api.sonz.ai/health && echo "OK"
```

User-facing natural-language test (preferred over API pokes):

> Say: "Remember: I like espresso."
>
> Then in a new turn ask: "What coffee do I like?"

---

## Final handoff

After successful setup, send this handoff message in the user's language.
Do not remove sections.

```text
Sonzai Mind Layer is ready.

-- WHAT YOU CAN DO NEXT --

From now on, you can use normal natural language to make OpenClaw
remember information. You do not need to call memory tools manually.

Examples:
- "Remember: I like espresso."
- "My project uses PostgreSQL and Rust by default."
- "I prefer concise answers and explicit types."

Later you can ask:
- "What coffee do I like?"
- "What's my default database?"

Your agent will also develop personality, mood, and relationship
state over time.

-- CURRENT CONNECTION --

Sonzai API: https://api.sonz.ai
Agent ID: <agent-id>
OpenClaw config file: ~/.openclaw/openclaw.json

-- RECOVERY --

The agent ID is deterministic (SHA1 of tenantID + agentName). Same
API key + same `agentName` always resolves to the same agent, so:

1. Keep your API key safe
2. Reinstall this plugin on the new machine
3. Write the same `apiKey` and `agentName` (or explicit `agentId`) back
   into `openclaw.json`
4. Restart OpenClaw to reconnect to the same memory space

-- BACKUP --

- Back up ~/.openclaw/openclaw.json (contains API key + agent ID)
- Memory itself lives in the Sonzai Mind Layer cloud — no local state
  needs backup
- You can export memory via the Sonzai dashboard at platform.sonz.ai
```

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Plugin not loading | Check `plugins.slots.contextEngine = "sonzai"` and `entries.sonzai.enabled = true` |
| API key rejected | Test with `curl -H "Authorization: Bearer sk-..." https://api.sonz.ai/v1/agents`; regenerate from dashboard if invalid |
| Agent not provisioning | Check network to api.sonz.ai; try explicit `agentId` in config |
| No recall | Confirm `assemble()` is firing — check OpenClaw gateway logs |
| Wrong agent | Ensure `agentName` is unique per OpenClaw instance if sharing one API key |

---

## Configuration reference

All settings in `~/.openclaw/openclaw.json` under `plugins.entries.sonzai`:

| Field | Env override | Default | Description |
| --- | --- | --- | --- |
| `apiKey` | `SONZAI_API_KEY` | required | Sonzai API key |
| `agentId` | `SONZAI_AGENT_ID` | auto-provision | Pre-existing agent UUID |
| `baseUrl` | `SONZAI_BASE_URL` | `https://api.sonz.ai` | API base URL |
| `agentName` | `SONZAI_AGENT_NAME` | `openclaw-agent` | Name for auto-provisioning |
| `contextTokenBudget` | — | `2000` | Max tokens for context injection |
| `disable.{mood,personality,relationships,memory,goals,interests,habits,knowledge}` | — | `false` | Skip specific context sections |

---

## Communication style

When talking to users:

- describe this as automatic, natural-language memory — no tool calls required
- mention that personality and mood evolve, not just memory
- keep the next step concrete: install, restart, try one short memory sentence
- prefer real conversational verification over low-level API demos
````

- [ ] **Step 3.2: Add `SKILL.md` to `package.json` `files` array**

Modify `package.json` — locate the `files` array (around line 43):

```json
  "files": [
    "dist",
    "LICENSE",
    "README.md"
  ],
```

Replace with:

```json
  "files": [
    "dist",
    "LICENSE",
    "README.md",
    "SKILL.md"
  ],
```

While here, also bump the version — locate:

```json
  "version": "1.1.1",
```

Replace with:

```json
  "version": "1.2.0",
```

- [ ] **Step 3.3: Verify the file ships in the packed tarball**

```bash
cd /Volumes/CORSAIR/code/sonzai/sonzai-openclaw
npm pack --dry-run 2>&1 | grep -E "SKILL\.md|README\.md"
```

Expected output includes both `SKILL.md` and `README.md`.

- [ ] **Step 3.4: Commit**

```bash
git add SKILL.md package.json
git commit -m "feat: add SKILL.md for agent-driven install

Installable skill manifest modeled on EverMind's evermind-ai-everos skill:
trigger phrases, numbered onboarding steps with an explicit pre-restart
notice, a strict Definition of Done checklist, and a mandatory final
handoff template. Lets AI coding assistants (Claude Code, Cursor) install
and verify the plugin through natural language instead of requiring the
user to read the README.

Bumps version to 1.2.0 (minor — new capability, no breaking changes)."
```

---

## Task 4: Mid-Session Memory Freshness Investigation

**Why:** The user reports that memory "goes missing during a session" — that facts saved via `afterTurn` don't surface in subsequent `assemble` calls within the same session. Our code-level review shows `assemble()` calls `getContext()` every turn with a fresh `query`, so the plugin side is doing the right thing. The question is whether `getContext.loaded_facts` actually does a per-query semantic search against fresh data, or returns a pre-aggregated snapshot. This task resolves the ambiguity with reproducible API calls before we commit to any backend work.

**Files:**
- Create: `scripts/verify-mid-session-memory.sh`
- Create: `docs/findings/2026-04-23-mid-session-memory.md`

- [ ] **Step 4.1: Create the verification script**

Create `scripts/verify-mid-session-memory.sh`:

```bash
#!/usr/bin/env bash
#
# Reproducible check of whether Sonzai's getContext endpoint returns
# facts that were just ingested via agents.process in the same session.
#
# Usage:
#   export SONZAI_API_KEY=sk-...
#   export SONZAI_AGENT_ID=<existing-test-agent-uuid>
#   export SONZAI_USER_ID=verify-user-$(date +%s)
#   ./scripts/verify-mid-session-memory.sh
#
# Exit 0 = memory is fresh mid-session (no backend work needed).
# Exit 1 = stale — triggers the follow-up backend plan.

set -euo pipefail

: "${SONZAI_API_KEY:?set SONZAI_API_KEY}"
: "${SONZAI_AGENT_ID:?set SONZAI_AGENT_ID}"
USER_ID="${SONZAI_USER_ID:-verify-user-$(date +%s)}"
BASE="${SONZAI_BASE_URL:-https://api.sonz.ai}"
SESSION_ID="verify-$(date +%s)"
QUERY="What kind of coffee do I like?"
FACT="I really love Ethiopian pour-over coffee with a medium roast."

auth=(-H "Authorization: Bearer ${SONZAI_API_KEY}" -H "Content-Type: application/json")

echo "== 1. Start session =="
curl -sf "${auth[@]}" -X POST \
  "${BASE}/v1/agents/${SONZAI_AGENT_ID}/sessions/start" \
  -d "{\"user_id\":\"${USER_ID}\",\"session_id\":\"${SESSION_ID}\"}" \
  | jq -c . || true

echo "== 2. Baseline getContext BEFORE ingestion =="
before=$(curl -sf "${auth[@]}" -X POST \
  "${BASE}/v1/agents/${SONZAI_AGENT_ID}/context" \
  -d "{\"user_id\":\"${USER_ID}\",\"session_id\":\"${SESSION_ID}\",\"query\":\"${QUERY}\"}")
echo "$before" | jq '{loaded_facts: (.loaded_facts // [] | length), recent_turns: (.recent_turns // [] | length)}'

echo "== 3. Process (ingest) a turn with the fact =="
curl -sf "${auth[@]}" -X POST \
  "${BASE}/v1/agents/${SONZAI_AGENT_ID}/process" \
  -d "{\"user_id\":\"${USER_ID}\",\"session_id\":\"${SESSION_ID}\",\"messages\":[{\"role\":\"user\",\"content\":\"${FACT}\"},{\"role\":\"assistant\",\"content\":\"Noted — Ethiopian pour-over, medium roast.\"}]}" \
  | jq -c . || true

echo "== 4. Wait 2s for extraction =="
sleep 2

echo "== 5. getContext AFTER ingestion, same query =="
after=$(curl -sf "${auth[@]}" -X POST \
  "${BASE}/v1/agents/${SONZAI_AGENT_ID}/context" \
  -d "{\"user_id\":\"${USER_ID}\",\"session_id\":\"${SESSION_ID}\",\"query\":\"${QUERY}\"}")
echo "$after" | jq '{loaded_facts: (.loaded_facts // [] | map(.atomic_text // .content)), recent_turns: (.recent_turns // [] | length)}'

echo "== 6. End session =="
curl -sf "${auth[@]}" -X POST \
  "${BASE}/v1/agents/${SONZAI_AGENT_ID}/sessions/end" \
  -d "{\"user_id\":\"${USER_ID}\",\"session_id\":\"${SESSION_ID}\",\"total_messages\":2,\"duration_seconds\":5}" \
  | jq -c . || true

echo
if echo "$after" | jq -e '(.loaded_facts // []) | map(.atomic_text // .content // "") | any(ascii_downcase | test("pour.?over|ethiopian|coffee"))' > /dev/null; then
  echo "RESULT: FRESH — mid-session memory works. No backend work needed."
  exit 0
else
  echo "RESULT: STALE — fact not retrievable same-session. Backend plan required."
  exit 1
fi
```

- [ ] **Step 4.2: Make it executable**

```bash
chmod +x scripts/verify-mid-session-memory.sh
```

- [ ] **Step 4.3: Run it against production**

You need a throwaway test agent for this. Create one if needed:

```bash
export SONZAI_API_KEY=sk-...  # real key
# Create a throwaway test agent:
curl -sf -X POST "https://api.sonz.ai/v1/agents" \
  -H "Authorization: Bearer ${SONZAI_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"name":"memory-verification-throwaway"}' | jq -r .agent_id
export SONZAI_AGENT_ID=<returned-uuid>
./scripts/verify-mid-session-memory.sh | tee /tmp/verify-output.log
```

- [ ] **Step 4.4: Record the finding**

Create `docs/findings/2026-04-23-mid-session-memory.md` with exactly this structure (fill in the `<result>` and `<verdict>` fields based on the script output):

```markdown
# Mid-Session Memory Freshness — 2026-04-23

## Method

Ran `scripts/verify-mid-session-memory.sh` against `https://api.sonz.ai`
with a throwaway test agent. Script:

1. Starts a session
2. Calls `getContext` with query "What kind of coffee do I like?" — records baseline
3. Calls `process` with the fact "I really love Ethiopian pour-over coffee with a medium roast"
4. Waits 2s
5. Calls `getContext` again with the same query, same session
6. Checks whether `loaded_facts` now contains the coffee fact

## Result

<paste the /tmp/verify-output.log output here, especially the jq summaries>

## Verdict

<one of:>
- **FRESH** — loaded_facts contained the coffee fact within 2s. No
  backend work needed. Task 4 closes the investigation.
- **STALE** — loaded_facts did not contain the coffee fact after 2s.
  Backend plan required (see "Next" below).
- **PARTIAL** — fact appeared in recent_turns or raw conversation but
  not in loaded_facts. Indicates extraction is async but raw history
  is available; suggests backend should expose recent_turns to the
  plugin.

## Next

<if FRESH>    Close this investigation. The "memory missing mid-session"
              symptom likely has a different root cause — instrument the
              OpenClaw gateway to confirm `assemble()` is firing per turn.

<if STALE>    Open a follow-up plan `2026-MM-DD-backend-mid-session-memory.md`
              in sonzai-ai-monolith-ts's plans directory. Scope: dual-write
              pre-consolidation turns to a short-TTL store (Redis sorted set
              keyed by agent:user) and expose them in getContext as
              `recent_turns`. Plugin renders recent_turns as
              `## Recent Context` section in systemPromptAddition.

<if PARTIAL>  Same as STALE but narrower — backend just needs to surface
              recent_turns in the context response; no dual-write needed
              if raw turns are already stored for extraction.
```

- [ ] **Step 4.5: Commit**

```bash
git add scripts/verify-mid-session-memory.sh docs/findings/2026-04-23-mid-session-memory.md
git commit -m "chore: verify mid-session memory freshness

Reproducible script + recorded finding determining whether Sonzai's
getContext endpoint returns facts ingested earlier in the same session
via agents.process. Gates whether a backend plan is needed."
```

---

## Final: Integration, Release, Handoff

- [ ] **Step 5.1: Full test suite + typecheck + lint**

```bash
bun run test && bun run typecheck && bun run lint
```

Expected: all green.

- [ ] **Step 5.2: Build the package**

```bash
bun run build
```

Expected: `dist/` populated, no errors.

- [ ] **Step 5.3: Verify publishable tarball**

```bash
npm pack --dry-run 2>&1 | grep -E "(SKILL|README|dist|LICENSE)\.md|\.js|\.cjs"
```

Expected: SKILL.md present, dist JS and type files present.

- [ ] **Step 5.4: Open PR**

```bash
git push -u origin feat/memory-improvements
gh pr create --title "feat: memory freshness + onboarding improvements (v1.2.0)" --body "$(cat <<'EOF'
## Summary

- Skip context fetch on OpenClaw's session-reset boilerplate (saves one no-value API call per `/new`)
- Guard against injected-context pollution via CONTEXT_BOUNDARY + afterTurn strip (defense-in-depth)
- Add SKILL.md so AI coding assistants can install and verify the plugin through natural language
- Document the mid-session memory freshness investigation (findings in `docs/findings/`)

## Test plan

- [ ] `bun run test` — all green
- [ ] `bun run typecheck` — no errors
- [ ] `npm pack --dry-run` — SKILL.md in tarball
- [ ] Ran `scripts/verify-mid-session-memory.sh` against prod; finding recorded
- [ ] Manual: start a new OpenClaw session with the plugin installed and confirm no `getContext` call fires on the initial `/new` boilerplate

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5.5: Post-merge release**

After PR merge:

```bash
git checkout main && git pull
just deploy 1.2.0    # existing recipe
```

Expected: npm package `@sonzai-labs/openclaw-context@1.2.0` published, tag pushed.

- [ ] **Step 5.6: Decide on the follow-up backend plan**

Read `docs/findings/2026-04-23-mid-session-memory.md`. If verdict is STALE or PARTIAL, create a new plan at
`/Volumes/CORSAIR/code/sonzai/sonzai-ai-monolith-ts/docs/superpowers/plans/YYYY-MM-DD-backend-mid-session-memory.md` that covers:

- Dual-write pre-consolidation turns to a short-TTL Redis sorted set keyed by `agent:user` (TTL ~1h)
- Extend `EnrichedContextResponse` with `recent_turns: RecentTurn[]`
- Regenerate Go / Python / TypeScript SDK types from the updated OpenAPI spec
- Bump `@sonzai-labs/agents` (minor) and cascade-release all three SDKs
- Bump `@sonzai-labs/openclaw-context` (patch) with a new `## Recent Context` section in `buildSystemPromptFromContext`

If verdict is FRESH, close the thread — the symptom lies elsewhere (likely OpenClaw gateway not calling `assemble()` per turn) and needs a different investigation.
