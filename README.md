# @sonzai-labs/openclaw-context

OpenClaw ContextEngine plugin for the [Sonzai Mind Layer](https://sonz.ai). Gives OpenClaw agents hierarchical memory, personality evolution, mood tracking, relationship modeling, and automatic fact extraction — powered by the Sonzai API.

## Quick Start

### Interactive Setup (Recommended)

```bash
# Install the plugin
openclaw plugins install @sonzai-labs/openclaw-context

# Run guided setup — validates your key, provisions agent, writes openclaw.json
npx @sonzai-labs/openclaw-context setup
```

The setup wizard will:
1. Ask for your Sonzai API key (or detect `SONZAI_API_KEY` from env)
2. Ask if you have an existing agent ID, or create one for you
3. Write your API key and plugin config to `openclaw.json`

That's it — restart OpenClaw and your agent has persistent memory. No environment variables needed.

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
| **assemble** | Fetches memory, mood, personality, relationships, goals, interests, and habits in parallel; injects as `systemPromptAddition` |
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
| `disable.mood` | — | `false` | Skip mood context |
| `disable.personality` | — | `false` | Skip personality context |
| `disable.relationships` | — | `false` | Skip relationship context |
| `disable.memory` | — | `false` | Skip memory search |
| `disable.goals` | — | `false` | Skip goals context |
| `disable.interests` | — | `false` | Skip interests context |
| `disable.habits` | — | `false` | Skip habits context |

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
