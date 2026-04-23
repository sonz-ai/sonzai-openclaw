/**
 * Interactive and programmatic setup for the Sonzai OpenClaw plugin.
 *
 * Interactive:  `npx @sonzai-labs/openclaw-context setup`
 * Programmatic: `import { setup } from "@sonzai-labs/openclaw-context"`
 */

import { Sonzai } from "@sonzai-labs/agents";
import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Programmatic setup — for B2B integrations
// ---------------------------------------------------------------------------

export interface SetupOptions {
  /** Sonzai API key. */
  apiKey: string;
  /** Agent name (deterministic ID derived from tenant + name). */
  agentName?: string;
  /** Pre-existing agent ID (skips agent provisioning). */
  agentId?: string;
  /** Base URL override. */
  baseUrl?: string;
  /** Path to openclaw.json. Defaults to ./openclaw.json */
  configPath?: string;
  /** If true, writes to openclaw.json. If false, returns config object only. */
  writeConfig?: boolean;
  /**
   * Supplementary memory recall timing. Defaults to "sync" — the plugin
   * blocks context build until recall completes so facts land in the
   * current turn. Use "async" only if first-token latency is a measured
   * concern and you accept that slow hits spill to the next turn.
   */
  memoryMode?: "sync" | "async";
}

export interface SetupResult {
  agentId: string;
  agentName: string;
  config: Record<string, unknown>;
  configPath?: string;
  written: boolean;
}

/**
 * Programmatic setup — validates API key, provisions agent, optionally
 * writes openclaw.json. Designed for B2B automation scripts.
 */
export async function setup(options: SetupOptions): Promise<SetupResult> {
  const baseUrl = options.baseUrl || "https://api.sonz.ai";
  const agentName = options.agentName || "openclaw-agent";
  const writeConfig = options.writeConfig ?? true;
  const configPath = options.configPath || "./openclaw.json";
  const memoryMode = options.memoryMode ?? "sync";

  // 1. Validate API key by provisioning / finding the agent
  const client = new Sonzai({ apiKey: options.apiKey, baseUrl });

  let agentId: string;
  if (options.agentId) {
    // Verify agent exists
    const agent = await client.agents.get(options.agentId);
    agentId = agent.agent_id;
  } else {
    // Idempotent create — backend derives deterministic UUID from tenant+name.
    // Seed the configured memoryMode so fresh agents inherit it.
    const agent = await client.agents.create({
      name: agentName,
      toolCapabilities: {
        web_search: false,
        remember_name: false,
        image_generation: false,
        inventory: false,
        memory_mode: memoryMode,
      },
    });
    agentId = agent.agent_id;
  }

  // 1b. Enforce memoryMode on the resolved agent (handles both pre-existing
  // and freshly-created agents — idempotent create doesn't overwrite
  // capabilities on existing agents).
  await client.agents.updateCapabilities(agentId, { memoryMode });

  // 2. Build the openclaw.json plugin config
  const pluginConfig = buildOpenClawConfig(options.apiKey, agentId, memoryMode);

  // 3. Optionally write to openclaw.json
  let written = false;
  if (writeConfig) {
    mergeOpenClawConfig(configPath, pluginConfig);
    written = true;
  }

  return {
    agentId,
    agentName,
    config: pluginConfig,
    configPath: written ? path.resolve(configPath) : undefined,
    written,
  };
}

// ---------------------------------------------------------------------------
// Interactive CLI setup — `npx @sonzai-labs/openclaw-context setup`
// ---------------------------------------------------------------------------

export async function interactiveSetup(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string): Promise<string> =>
    new Promise((resolve) => rl.question(question, resolve));

  console.log("\n🦞 Sonzai Mind Layer — OpenClaw Plugin Setup\n");

  try {
    // Step 1: API Key
    const envKey = process.env.SONZAI_API_KEY;
    let apiKey: string;
    if (envKey) {
      const useEnv = await ask(
        `Found SONZAI_API_KEY in environment (${envKey.slice(0, 8)}...). Use it? [Y/n] `,
      );
      apiKey = useEnv.toLowerCase() === "n" ? await ask("Enter your Sonzai API key: ") : envKey;
    } else {
      apiKey = await ask("Enter your Sonzai API key (from https://sonz.ai/settings/api): ");
    }

    if (!apiKey.trim()) {
      console.log("No API key provided. Aborting.");
      return;
    }

    // Step 2: Agent
    const hasAgent = await ask("Do you have an existing Sonzai agent ID? [y/N] ");
    let agentId: string | undefined;
    let agentName = "openclaw-agent";

    if (hasAgent.toLowerCase() === "y") {
      agentId = await ask("Enter agent ID: ");
    } else {
      const customName = await ask(
        `Agent name for auto-provisioning [openclaw-agent]: `,
      );
      if (customName.trim()) agentName = customName.trim();
    }

    // Step 3: Memory mode
    const memoryModeAnswer = await ask(
      "Memory recall mode — [s]ync (recommended, default) or [a]sync (lower latency, may spill facts): ",
    );
    const memoryMode: "sync" | "async" =
      memoryModeAnswer.trim().toLowerCase().startsWith("a") ? "async" : "sync";

    // Step 4: Validate
    console.log("\nValidating API key and provisioning agent...");
    const result = await setup({
      apiKey: apiKey.trim(),
      agentId: agentId?.trim() || undefined,
      agentName,
      memoryMode,
      writeConfig: false,
    });
    console.log(`Agent ready: ${result.agentId} (memoryMode=${memoryMode})`);

    // Step 5: Write config
    const configPath = await ask("Path to openclaw.json [./openclaw.json]: ");
    const resolvedPath = configPath.trim() || "./openclaw.json";

    mergeOpenClawConfig(resolvedPath, result.config);
    console.log(`\nConfig written to ${path.resolve(resolvedPath)}`);

    // Step 6: Done
    console.log("\n--- Setup Complete ---\n");
    console.log(
      "Your API key and agent ID are saved in openclaw.json — no environment variables needed.\n",
    );
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildOpenClawConfig(
  apiKey: string,
  agentId: string,
  memoryMode: "sync" | "async",
): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    enabled: true,
    apiKey,
    agentId,
  };
  // Only write memoryMode when non-default, to keep openclaw.json minimal.
  if (memoryMode !== "sync") {
    entry.memoryMode = memoryMode;
  }
  return {
    plugins: {
      slots: {
        contextEngine: "sonzai",
      },
      entries: {
        sonzai: entry,
      },
    },
  };
}

function mergeOpenClawConfig(
  configPath: string,
  pluginConfig: Record<string, unknown>,
): void {
  let existing: Record<string, unknown> = {};

  const resolvedPath = path.resolve(configPath);
  if (fs.existsSync(resolvedPath)) {
    try {
      const raw = fs.readFileSync(resolvedPath, "utf-8");
      existing = JSON.parse(raw);
    } catch {
      // If parse fails, start fresh
    }
  }

  // Deep merge plugins section
  const merged = { ...existing };
  const existingPlugins = (merged.plugins || {}) as Record<string, unknown>;
  const newPlugins = pluginConfig.plugins as Record<string, unknown>;

  const existingSlots = (existingPlugins.slots || {}) as Record<string, unknown>;
  const newSlots = (newPlugins.slots || {}) as Record<string, unknown>;

  const existingEntries = (existingPlugins.entries || {}) as Record<string, unknown>;
  const newEntries = (newPlugins.entries || {}) as Record<string, unknown>;

  merged.plugins = {
    ...existingPlugins,
    slots: { ...existingSlots, ...newSlots },
    entries: { ...existingEntries, ...newEntries },
  };

  fs.writeFileSync(resolvedPath, JSON.stringify(merged, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/** Run when invoked as `npx @sonzai-labs/openclaw-context setup` */
export async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === "setup") {
    await interactiveSetup();
  } else {
    console.log("Usage: npx @sonzai-labs/openclaw-context setup");
    console.log("\nRun interactive setup to configure the Sonzai OpenClaw plugin.");
  }
}
