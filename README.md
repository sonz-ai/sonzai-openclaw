# @sonzai-labs/openclaw-context

OpenClaw ContextEngine plugin for the [Sonzai Mind Layer](https://sonz.ai). Gives OpenClaw agents hierarchical memory, personality evolution, mood tracking, relationship modeling, and automatic fact extraction — powered by the Sonzai API.

## Quick Start

### One-shot install (recommended)

```bash
npx --yes @sonzai-labs/openclaw-context install
```

This probes backend health, runs `openclaw plugins install`, launches the interactive config wizard, and prints the restart instruction. One command end-to-end.

### Interactive Setup

```bash
openclaw plugins install @sonzai-labs/openclaw-context
npx @sonzai-labs/openclaw-context setup
```

The setup wizard will:
1. Ask for your Sonzai API key (or detect `SONZAI_API_KEY` from env)
2. Ask if you have an existing agent ID, or create one for you
3. Ask whether memory recall should be `sync` (default) or `async`
4. Write your API key and plugin config to `openclaw.json`

That's it — restart OpenClaw and your agent has persistent memory. No environment variables needed.

### Backend health check

Before installing, verify the backend is reachable:

```bash
curl -sf https://api.sonz.ai/health && echo "OK"
# or
npx @sonzai-labs/openclaw-context health
```

### Manual Setup

```bash
# 1. Install
openclaw plugins install @sonzai-labs/openclaw-context
```

Add to your `openclaw.json`:

```json5
{
  "plugins": {
    "slots": {
      "contextEngine": "sonzai"
    },
    "entries": {
      "sonzai": {
        "enabled": true,
        "apiKey": "sk-your-api-key",
        "agentId": "your-agent-uuid"  // optional — auto-provisioned if omitted
      }
    }
  }
}
```

`openclaw.json` acts as your config file — no environment variables needed.

## B2B Integration (Programmatic Setup)

For platforms deploying OpenClaw at scale, use the programmatic setup API
in your provisioning scripts:

```typescript
import { setup } from "@sonzai-labs/openclaw-context";

// One-liner: validates key, provisions agent, writes openclaw.json
const result = await setup({
  apiKey: "sk-project-scoped-key",
  agentName: "customer-support-bot",   // stable name → deterministic agent ID
  configPath: "/path/to/openclaw.json",
});

console.log(result.agentId);   // "a1b2c3d4-..."
console.log(result.written);   // true — config file updated
```

### B2B Provisioning Script Example

```typescript
import { setup } from "@sonzai-labs/openclaw-context";

// Called once per tenant during onboarding
async function provisionOpenClawForTenant(tenantName: string) {
  const result = await setup({
    apiKey: process.env.SONZAI_PROJECT_KEY!,
    agentName: `${tenantName}-assistant`,  // unique per tenant
    configPath: `/etc/openclaw/${tenantName}/openclaw.json`,
  });

  // Store the agent ID in your DB for reference
  await db.tenants.update(tenantName, { sonzaiAgentId: result.agentId });
}
```

### Kubernetes / Docker Deployments

The agent ID is deterministic: `SHA1(tenantID + agentName)`. As long as your
config has the same API key + agent name (or explicit agent ID), pods can
restart, scale, or be replaced without creating duplicate agents.

For containerized environments, you can either bake the API key into `openclaw.json`
or use env vars as overrides (useful for secrets management):

```yaml
# Example: K8s deployment — env var overrides openclaw.json
env:
  - name: SONZAI_API_KEY
    valueFrom:
      secretKeyRef:
        name: sonzai-secrets
        key: api-key
  - name: SONZAI_AGENT_ID
    value: "a1b2c3d4-e5f6-..."  # from provisioning step
```

### Config-Only (No Env Vars)

Everything can live in `openclaw.json` — no env vars required:

```typescript
const result = await setup({
  apiKey: "sk-...",
  agentName: "my-bot",
  writeConfig: true,
  configPath: "./openclaw.json",
});
// API key and agent ID are both written to openclaw.json.
```

## How It Works

The plugin replaces OpenClaw's default Markdown-file memory with Sonzai's Mind Layer:

| OpenClaw Hook | What Happens |
|---------------|-------------|
| **bootstrap** | Starts a Sonzai session; provisions agent if needed |
| **ingest** | No-op (processing deferred to afterTurn) |
| **assemble** | Single `getContext` call fetches memory, mood, personality, relationships, goals, interests, habits, and recent_turns (server-side parallelized); injects as `systemPromptAddition` |
| **compact** | Triggers Sonzai's consolidation pipeline (replaces OpenClaw's summarization) |
| **afterTurn** | Sends conversation to Sonzai for fact extraction |
| **dispose** | Ends all active sessions cleanly |

### Context Injection

Before each LLM call, the plugin injects a `<sonzai-context>` block into the system prompt containing:

- Agent personality profile and Big5 traits
- Current mood state
- Relationship data with the current user
- Semantically relevant memories (searched by last user message)
- Active goals
- User interests
- Behavioral habits

If any API call fails, it's silently skipped — the plugin never blocks OpenClaw.

### Mid-session memory retrieval

`assemble()` runs before every LLM turn and calls `getContext` with the current user message as the query — so memory search is **per-turn**, not a session-start snapshot.

Two classes of memory are surfaced:

- **Consolidated facts** (`loaded_facts`) — extracted from prior sessions and promoted by the consolidation pipeline. Always available.
- **Recent turns** (`recent_turns`) — raw messages from the current session, pushed on every `process()` call, TTL 2h. Closes the latency gap for facts the user just stated this turn but hasn't been consolidated into a canonical fact yet.

The Sonzai backend writes recent turns on each `afterTurn` → `process()` and surfaces them on the next `assemble` → `getContext` call. So a fact stated this turn is retrievable next turn even before the consolidation pipeline has run.

### User Identity

The plugin automatically extracts user identity from OpenClaw session keys:

| Session Type | Example Key | Resolved userId |
|-------------|------------|-----------------|
| CLI (1:1) | `agent:abc:mainKey` | `"owner"` (default) |
| Telegram DM | `agent:abc:telegram:direct:123` | `"123"` |
| WhatsApp DM | `agent:abc:whatsapp:direct:+1555...` | `"+1555..."` |
| Discord group | `agent:abc:discord:group:guild789` | `"guild789"` |

### Agent ID Stability

The Sonzai backend derives agent IDs deterministically:

```
agentId = SHA1(namespace, tenantID + "/" + lowercase(agentName))
```

Same API key + same name = same agent UUID, always. Safe across:
- Pod restarts and replacements
- Container recreation
- Multiple replicas (they all resolve to the same agent)
- `openclaw plugins install` re-runs

To get **separate** agents under one API key, use different `agentName` values.

## Full Configuration Reference

All settings go in `openclaw.json` under `plugins.entries.sonzai`. Environment variables are supported as overrides.

| Setting | Env Var Override | Default | Description |
|---------|-----------------|---------|-------------|
| `apiKey` | `SONZAI_API_KEY` | *required* | Sonzai API key |
| `agentId` | `SONZAI_AGENT_ID` | auto-provision | Pre-provisioned agent UUID |
| `baseUrl` | `SONZAI_BASE_URL` | `https://api.sonz.ai` | API base URL |
| `agentName` | `SONZAI_AGENT_NAME` | `openclaw-agent` | Name for auto-provisioned agents |
| `defaultUserId` | — | `owner` | Default userId for CLI (1:1) sessions |
| `contextTokenBudget` | — | `2000` | Max tokens for context injection |
| `memoryMode` | `SONZAI_MEMORY_MODE` | `sync` | Memory recall timing. `sync` blocks context build until recall returns (per-turn completeness); `async` races a deadline (lower first-token latency, slow hits spill to next turn). |
| `disable.mood` | — | `false` | Skip mood context |
| `disable.personality` | — | `false` | Skip personality context |
| `disable.relationships` | — | `false` | Skip relationship context |
| `disable.memory` | — | `false` | Skip memory search |
| `disable.goals` | — | `false` | Skip goals context |
| `disable.interests` | — | `false` | Skip interests context |
| `disable.habits` | — | `false` | Skip habits context |
| `disable.knowledge` | — | `false` | Skip knowledge-base context |
| `extractionProvider` | `SONZAI_EXTRACTION_PROVIDER` | `gemini` | LLM provider used for fact extraction. Optional. Override to route extraction through `openai`, `anthropic`, etc. |
| `extractionModel` | `SONZAI_EXTRACTION_MODEL` | `gemini-3.1-flash-lite` | LLM model used for fact extraction. Optional — this is the default floor. Override with a heavier model like `gemini-3.1-pro-preview` to trade latency/cost for extraction quality. |

### Switching memory mode

The plugin enforces the configured `memoryMode` on every bootstrap, so changing
`plugins.entries.sonzai.memoryMode` in `openclaw.json` (or setting
`SONZAI_MEMORY_MODE=async`) takes effect on the next session start — no
manual agent update needed:

```json5
{
  "plugins": {
    "entries": {
      "sonzai": {
        "apiKey": "sk-...",
        "memoryMode": "async"  // default is "sync"
      }
    }
  }
}
```

## REST API reference

The plugin calls these endpoints on your behalf via the `@sonzai-labs/agents` SDK. Always up-to-date — run `just sync-spec` to re-pull the production spec and regenerate the table.

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

## Programmatic Engine Usage

The engine can also be used directly outside OpenClaw:

```typescript
import { Sonzai } from "@sonzai-labs/agents";
import { SonzaiContextEngine, resolveConfig } from "@sonzai-labs/openclaw-context";

const client = new Sonzai({ apiKey: "sk-..." });
const config = resolveConfig({ apiKey: "sk-...", agentId: "agent-123" });
const engine = new SonzaiContextEngine(client, config);

await engine.bootstrap({ sessionId: "my-session" });
const { systemPromptAddition } = await engine.assemble({
  sessionId: "my-session",
  messages: [{ role: "user", content: "Hello!" }],
  tokenBudget: 4000,
});
```

## License

MIT
