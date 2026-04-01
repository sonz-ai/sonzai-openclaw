/**
 * Plugin configuration — maps to `plugins.entries.sonzai` in openclaw.json
 * or environment variables.
 */

export interface DisableMap {
  mood?: boolean;
  personality?: boolean;
  relationships?: boolean;
  memory?: boolean;
  goals?: boolean;
  interests?: boolean;
  habits?: boolean;
}

export interface SonzaiPluginConfig {
  /** Sonzai API key (sk-...). Required. */
  apiKey: string;
  /** Pre-provisioned agent UUID. If omitted, auto-provisions from agentName. */
  agentId?: string;
  /** Base URL override (e.g. for staging). Defaults to https://api.sonz.ai */
  baseUrl?: string;
  /**
   * Agent name for auto-provisioning. The backend derives a deterministic
   * UUID from (tenantID + lowercase(name)), so the same API key + same name
   * always maps to the same agent — no duplicates across restarts.
   *
   * IMPORTANT for B2B: if multiple OpenClaw instances share one API key,
   * each needs a unique agentName to get its own Sonzai agent.
   * Defaults to "openclaw-agent".
   */
  agentName?: string;
  /** Default userId when session key has no peer identity (CLI 1:1). Defaults to "owner". */
  defaultUserId?: string;
  /** Max tokens for Sonzai context injection. Defaults to 2000. */
  contextTokenBudget?: number;
  /** Selectively disable context sources. */
  disable?: DisableMap;
}

export interface ResolvedConfig {
  apiKey: string;
  agentId: string | undefined;
  baseUrl: string;
  agentName: string;
  defaultUserId: string;
  contextTokenBudget: number;
  disable: DisableMap;
}

const DEFAULTS = {
  baseUrl: "https://api.sonz.ai",
  agentName: "openclaw-agent",
  defaultUserId: "owner",
  contextTokenBudget: 2000,
} as const;

/**
 * Resolve configuration from explicit config, then fall back to env vars.
 */
export function resolveConfig(raw?: Partial<SonzaiPluginConfig>): ResolvedConfig {
  const apiKey =
    raw?.apiKey ||
    env("SONZAI_API_KEY") ||
    env("SONZAI_OPENCLAW_API_KEY");

  if (!apiKey) {
    throw new Error(
      "[@sonzai-labs/openclaw-context] Missing API key. " +
      "Set apiKey in plugin config or SONZAI_API_KEY environment variable.",
    );
  }

  return {
    apiKey,
    agentId: raw?.agentId || env("SONZAI_AGENT_ID") || undefined,
    baseUrl: raw?.baseUrl || env("SONZAI_BASE_URL") || DEFAULTS.baseUrl,
    agentName: raw?.agentName || env("SONZAI_AGENT_NAME") || DEFAULTS.agentName,
    defaultUserId: raw?.defaultUserId || DEFAULTS.defaultUserId,
    contextTokenBudget: raw?.contextTokenBudget ?? DEFAULTS.contextTokenBudget,
    disable: raw?.disable ?? {},
  };
}

function env(key: string): string | undefined {
  try {
    return typeof process !== "undefined" ? process.env[key] : undefined;
  } catch {
    return undefined;
  }
}
