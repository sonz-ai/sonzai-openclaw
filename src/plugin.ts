/**
 * OpenClaw plugin entry point.
 *
 * Registers the "sonzai" ContextEngine with OpenClaw's plugin system.
 */

import { Sonzai } from "@sonzai-labs/agents";
import { resolveConfig } from "./config.js";
import { SonzaiContextEngine } from "./engine.js";
import type { PluginAPI, ContextEngine } from "./types.js";

export default function register(api: PluginAPI): void {
  api.registerContextEngine("sonzai", (): ContextEngine => {
    const config = resolveConfig();
    const client = new Sonzai({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
    });
    return new SonzaiContextEngine(client, config);
  });
}
