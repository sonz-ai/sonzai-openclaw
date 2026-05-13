/**
 * Plugin configuration — maps to `plugins.entries.sonzai` in openclaw.json
 * or environment variables.
 *
 * openclaw.json acts as the primary config source (like a .env file).
 * Environment variables are supported as an override / fallback.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface DisableMap {
  mood?: boolean;
  personality?: boolean;
  relationships?: boolean;
  memory?: boolean;
  goals?: boolean;
  interests?: boolean;
  habits?: boolean;
  knowledge?: boolean;
}

export type MemoryMode = "sync" | "async";

/**
 * BYOK provider names accepted by the Sonzai platform.
 * Must stay in sync with the BYOKProvider type in @sonzai-labs/agents.
 */
export type ByokProvider = "openai" | "gemini" | "xai" | "openrouter";

export type ByokKeys = Partial<Record<ByokProvider, string>>;

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
  /**
   * LLM provider for side-effect fact extraction. Optional — the Sonzai
   * backend defaults to "gemini" if omitted. Set to "openai", "anthropic",
   * etc. to route extraction through a different provider.
   */
  extractionProvider?: string;
  /**
   * LLM model for side-effect fact extraction. Optional — the Sonzai backend
   * defaults to `gemini-3.1-flash-lite` if omitted (the extraction
   * floor). Override with a heavier model like `gemini-3.1-pro-preview` to
   * trade latency/cost for extraction quality.
   */
  extractionModel?: string;
  /**
   * Supplementary memory recall timing on the Sonzai backend.
   *
   * - `"sync"` (default) blocks context build until memory recall returns, so
   *   every fact lands in the current turn. Recommended for OpenClaw since
   *   per-turn completeness matters more than first-token latency.
   * - `"async"` races recall against a deadline — slow hits spill to the next
   *   turn. Choose this only if you've measured first-token latency as a
   *   blocker.
   *
   * The plugin enforces this on every bootstrap, so changes to the config
   * take effect on the next session start without manual agent updates.
   */
  memoryMode?: MemoryMode;
  /**
   * Sonzai project UUID for BYOK (bring-your-own-key) registration.
   *
   * Only required when `byok` keys are configured. If omitted, the plugin
   * auto-discovers the tenant's "Default" project via projects.list().
   * Override here if your API key is scoped to a non-Default project.
   *
   * Resolved from `SONZAI_PROJECT_ID` env var when not in config.
   */
  projectId?: string;
  /**
   * Customer-provided LLM provider API keys. When set, openclaw registers
   * them with the Sonzai platform on startup via the BYOK endpoint; the
   * platform then uses your key for upstream LLM calls and bills you only
   * its 25% service fee instead of the full 125% markup.
   *
   * Per-provider resolution precedence (highest to lowest):
   *   1. `byok.<provider>` in config / openclaw.json
   *   2. `SONZAI_BYOK_<PROVIDER>_KEY` env var (namespaced, recommended)
   *   3. `<PROVIDER>_API_KEY` env var (standard, may be shared with other tools)
   *
   * Registration is fire-and-forget on bootstrap; failures are logged but
   * do not block plugin startup. Re-runs each registration on every plugin
   * load (idempotent via PUT semantics on the platform).
   */
  byok?: ByokKeys;
}

export interface ResolvedConfig {
  apiKey: string;
  agentId: string | undefined;
  baseUrl: string;
  agentName: string;
  defaultUserId: string;
  contextTokenBudget: number;
  disable: DisableMap;
  extractionProvider: string | undefined;
  extractionModel: string | undefined;
  memoryMode: MemoryMode;
  projectId: string | undefined;
  byok: ByokKeys;
}

const BYOK_PROVIDERS: readonly ByokProvider[] = ["openai", "gemini", "xai", "openrouter"] as const;

/**
 * Standard provider env-var names, used as the lowest-precedence fallback.
 * Gemini accepts both GEMINI_API_KEY (Google AI Studio convention) and
 * GOOGLE_API_KEY (broader Google ecosystem); namespaced overrides win.
 */
const STANDARD_ENV_NAMES: Record<ByokProvider, readonly string[]> = {
  openai: ["OPENAI_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  xai: ["XAI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
};

const DEFAULTS = {
  baseUrl: "https://api.sonz.ai",
  agentName: "openclaw-agent",
  defaultUserId: "owner",
  contextTokenBudget: 2000,
  memoryMode: "sync" as MemoryMode,
} as const;

/**
 * Read the `plugins.entries.sonzai` section from openclaw.json.
 * Returns an empty object if the file doesn't exist or can't be parsed.
 */
export function readFileConfig(configPath?: string): Partial<SonzaiPluginConfig> {
  const resolved = path.resolve(configPath || "./openclaw.json");
  try {
    if (!fs.existsSync(resolved)) return {};
    const raw = JSON.parse(fs.readFileSync(resolved, "utf-8"));
    const entry = raw?.plugins?.entries?.sonzai;
    return entry && typeof entry === "object" ? entry : {};
  } catch {
    return {};
  }
}

/**
 * Resolve configuration from explicit config, then openclaw.json, then env vars.
 *
 * Precedence (highest to lowest):
 *   1. Explicit `raw` config object (programmatic usage)
 *   2. openclaw.json `plugins.entries.sonzai` section
 *   3. Environment variables (SONZAI_API_KEY, etc.)
 */
export function resolveConfig(
  raw?: Partial<SonzaiPluginConfig>,
  configPath?: string,
): ResolvedConfig {
  const file = readFileConfig(configPath);

  const apiKey =
    raw?.apiKey ||
    file.apiKey ||
    env("SONZAI_API_KEY") ||
    env("SONZAI_OPENCLAW_API_KEY");

  if (!apiKey) {
    throw new Error(
      "[@sonzai-labs/openclaw-context] Missing API key. " +
      "Set apiKey in openclaw.json, plugin config, or SONZAI_API_KEY environment variable.",
    );
  }

  return {
    apiKey,
    agentId: raw?.agentId || file.agentId || env("SONZAI_AGENT_ID") || undefined,
    baseUrl: raw?.baseUrl || file.baseUrl || env("SONZAI_BASE_URL") || DEFAULTS.baseUrl,
    agentName: raw?.agentName || file.agentName || env("SONZAI_AGENT_NAME") || DEFAULTS.agentName,
    defaultUserId: raw?.defaultUserId || file.defaultUserId || DEFAULTS.defaultUserId,
    contextTokenBudget: raw?.contextTokenBudget ?? file.contextTokenBudget ?? DEFAULTS.contextTokenBudget,
    disable: raw?.disable ?? file.disable ?? {},
    extractionProvider: raw?.extractionProvider || file.extractionProvider || env("SONZAI_EXTRACTION_PROVIDER") || undefined,
    extractionModel: raw?.extractionModel || file.extractionModel || env("SONZAI_EXTRACTION_MODEL") || undefined,
    memoryMode: resolveMemoryMode(raw?.memoryMode, file.memoryMode, env("SONZAI_MEMORY_MODE")),
    projectId: raw?.projectId || file.projectId || env("SONZAI_PROJECT_ID") || undefined,
    byok: resolveByokKeys(raw?.byok, file.byok),
  };
}

/**
 * Resolve BYOK keys per provider with the documented precedence:
 *   config/openclaw.json → SONZAI_BYOK_<PROVIDER>_KEY → <PROVIDER>_API_KEY.
 * Returns only providers with a non-empty key — easy to test for emptiness
 * with Object.keys(byok).length.
 */
function resolveByokKeys(
  raw: ByokKeys | undefined,
  file: ByokKeys | undefined,
): ByokKeys {
  const result: ByokKeys = {};
  for (const provider of BYOK_PROVIDERS) {
    const fromConfig = raw?.[provider] || file?.[provider];
    if (fromConfig) {
      result[provider] = fromConfig;
      continue;
    }
    const namespaced = env(`SONZAI_BYOK_${provider.toUpperCase()}_KEY`);
    if (namespaced) {
      result[provider] = namespaced;
      continue;
    }
    for (const name of STANDARD_ENV_NAMES[provider]) {
      const v = env(name);
      if (v) {
        result[provider] = v;
        break;
      }
    }
  }
  return result;
}

function resolveMemoryMode(
  ...candidates: (string | undefined)[]
): MemoryMode {
  for (const c of candidates) {
    if (c === "sync" || c === "async") return c;
    if (c !== undefined && c !== "") {
      throw new Error(
        `[@sonzai-labs/openclaw-context] Invalid memoryMode: ${JSON.stringify(c)}. Must be "sync" or "async".`,
      );
    }
  }
  return DEFAULTS.memoryMode;
}

function env(key: string): string | undefined {
  try {
    return typeof process !== "undefined" ? process.env[key] : undefined;
  } catch {
    return undefined;
  }
}
