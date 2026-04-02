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
  /** LLM provider for side-effect extraction (e.g. "gemini", "openai"). Uses platform default if omitted. */
  extractionProvider?: string;
  /** LLM model for side-effect extraction (e.g. "gemini-2.5-flash"). Uses platform default if omitted. */
  extractionModel?: string;
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
}

const DEFAULTS = {
  baseUrl: "https://api.sonz.ai",
  agentName: "openclaw-agent",
  defaultUserId: "owner",
  contextTokenBudget: 2000,
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
  };
}

function env(key: string): string | undefined {
  try {
    return typeof process !== "undefined" ? process.env[key] : undefined;
  } catch {
    return undefined;
  }
}
