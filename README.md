# @sonzai-labs/openclaw-context

OpenClaw ContextEngine plugin for the [Sonzai Mind Layer](https://sonz.ai). Gives OpenClaw agents hierarchical memory, personality evolution, mood tracking, relationship modeling, and automatic fact extraction — powered by the Sonzai API.

## Installation

```bash
openclaw plugins install @sonzai-labs/openclaw-context
```

Or manually:

```bash
npm install @sonzai-labs/openclaw-context @sonzai-labs/agents
```

## Configuration

### Option 1: Environment Variables

```bash
export SONZAI_API_KEY="sk-your-api-key"
export SONZAI_AGENT_ID="your-agent-uuid"  # optional — auto-provisions if omitted
```

### Option 2: openclaw.json

```json5
{
  "plugins": {
    "slots": {
      "contextEngine": "sonzai"
    },
    "entries": {
      "sonzai": {
        "enabled": true
      }
    }
  }
}
```

### Full Configuration Reference

| Setting | Env Var | Default | Description |
|---------|---------|---------|-------------|
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

## How It Works

The plugin replaces OpenClaw's default Markdown-file memory with Sonzai's Mind Layer:

| OpenClaw Hook | What Happens |
|---------------|-------------|
| **bootstrap** | Starts a Sonzai session; auto-provisions agent if needed |
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

## Usage Scenarios

### Individual Developer

1. Create an agent at [sonz.ai](https://sonz.ai) or via the SDK
2. Set `SONZAI_API_KEY` and `SONZAI_AGENT_ID`
3. Install the plugin — your OpenClaw agent now has persistent memory

### B2B Platform

1. Obtain a project-scoped API key from Sonzai
2. Set `SONZAI_API_KEY` (no agent ID needed)
3. Agents auto-provision via the idempotent create endpoint
4. Each OpenClaw instance gets its own Sonzai agent scoped to your project

## Programmatic Usage

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
