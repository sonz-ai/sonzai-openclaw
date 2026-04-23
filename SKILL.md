---
name: sonzai-mind-layer
version: 1.3.2
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

### Step 0b — Backend health check

Confirm the Sonzai backend is reachable before doing anything else:

```bash
curl -sf https://api.sonz.ai/health && echo "OK"
```

If this fails, tell the user plainly: "api.sonz.ai is unreachable right now — I can still install the plugin, but memory won't work until the backend is reachable."

(For self-hosted deployments: swap the URL. You can also run `npx @sonzai-labs/openclaw-context health` or `health https://your-host/...`.)

### Step 1 — Check / obtain API key

If the user has not mentioned a key, ask:

> Do you have a Sonzai API key? If not, get one at
> https://sonz.ai/settings/api. Keys start with `sk-`.

Do not proceed without a key.

### Step 2 — Install plugin

**One-shot (recommended):**

```bash
npx --yes @sonzai-labs/openclaw-context install
```

This does everything in one command:

- probes backend `/health`
- runs `openclaw plugins install @sonzai-labs/openclaw-context`
- launches the interactive config wizard
- prints the restart instruction

When the wizard prompts for a config path, enter `~/.openclaw/openclaw.json` (OpenClaw's canonical location) rather than accepting the `./openclaw.json` default.

**Two-step alternative** (if the one-shot fails or you want control):

```bash
openclaw plugins install @sonzai-labs/openclaw-context
npx @sonzai-labs/openclaw-context setup
```

**Non-interactive / CI:**

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
| `memoryMode` | `SONZAI_MEMORY_MODE` | `sync` | Memory recall timing — `sync` (default, per-turn completeness) or `async` (lower first-token latency, slow hits may spill to next turn). Enforced on every bootstrap. |
| `extractionProvider` | `SONZAI_EXTRACTION_PROVIDER` | `gemini` | Optional. LLM provider for fact extraction. Override to use `openai`, `anthropic`, etc. |
| `extractionModel` | `SONZAI_EXTRACTION_MODEL` | `gemini-3.1-flash-lite-preview` | Optional. LLM model for fact extraction — this is the default extraction floor. Override with `gemini-3.1-pro-preview` etc. to trade latency for quality. |
| `disable.{mood,personality,relationships,memory,goals,interests,habits,knowledge}` | — | `false` | Skip specific context sections |

---

## REST API reference

The plugin calls these Sonzai endpoints. Always up-to-date: run `just sync-spec` to re-pull the spec and regenerate the table below.

<!-- api-ref:start -->
_Generated from `spec/openapi.json` (API version **1.0.0**, synced 2026-04-23) — re-run `just sync-spec` to refresh._

| Method | Path | What the plugin uses it for |
|--------|------|------------------------------|
| `GET` | `/agents/{agentId}` | Fetch agent metadata |
| `GET` | `/agents/{agentId}/context` | Enriched context for assemble() — per turn |
| `POST` | `/agents` | Provision / look up agent (idempotent) |
| `POST` | `/agents/{agentId}/memory/consolidate` | Consolidation pipeline trigger from compact() |
| `POST` | `/agents/{agentId}/process` | Fact extraction from afterTurn() |
| `POST` | `/agents/{agentId}/sessions/end` | Session close — dispose() |
| `POST` | `/agents/{agentId}/sessions/start` | Session open — bootstrap() |
| `PUT` | `/agents/{agentId}/capabilities` | Enforce memoryMode on every bootstrap |
<!-- api-ref:end -->

---

## Communication style

When talking to users:

- describe this as automatic, natural-language memory — no tool calls required
- mention that personality and mood evolve, not just memory
- keep the next step concrete: install, restart, try one short memory sentence
- prefer real conversational verification over low-level API demos
