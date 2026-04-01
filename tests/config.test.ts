import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveConfig } from "../src/config.js";

describe("resolveConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.SONZAI_API_KEY;
    delete process.env.SONZAI_OPENCLAW_API_KEY;
    delete process.env.SONZAI_AGENT_ID;
    delete process.env.SONZAI_BASE_URL;
    delete process.env.SONZAI_AGENT_NAME;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws if no API key is provided", () => {
    expect(() => resolveConfig()).toThrow("Missing API key");
  });

  it("accepts apiKey from config", () => {
    const config = resolveConfig({ apiKey: "sk-test-123" });
    expect(config.apiKey).toBe("sk-test-123");
  });

  it("falls back to SONZAI_API_KEY env var", () => {
    process.env.SONZAI_API_KEY = "sk-env-key";
    const config = resolveConfig();
    expect(config.apiKey).toBe("sk-env-key");
  });

  it("falls back to SONZAI_OPENCLAW_API_KEY env var", () => {
    process.env.SONZAI_OPENCLAW_API_KEY = "sk-openclaw-key";
    const config = resolveConfig();
    expect(config.apiKey).toBe("sk-openclaw-key");
  });

  it("config apiKey takes precedence over env var", () => {
    process.env.SONZAI_API_KEY = "sk-env-key";
    const config = resolveConfig({ apiKey: "sk-config-key" });
    expect(config.apiKey).toBe("sk-config-key");
  });

  it("applies default values", () => {
    const config = resolveConfig({ apiKey: "sk-test" });
    expect(config.baseUrl).toBe("https://api.sonz.ai");
    expect(config.agentName).toBe("openclaw-agent");
    expect(config.defaultUserId).toBe("owner");
    expect(config.contextTokenBudget).toBe(2000);
    expect(config.disable).toEqual({});
    expect(config.agentId).toBeUndefined();
  });

  it("respects provided overrides", () => {
    const config = resolveConfig({
      apiKey: "sk-test",
      agentId: "agent-123",
      baseUrl: "https://staging.sonz.ai",
      agentName: "my-agent",
      defaultUserId: "admin",
      contextTokenBudget: 4000,
      disable: { mood: true, habits: true },
    });
    expect(config.agentId).toBe("agent-123");
    expect(config.baseUrl).toBe("https://staging.sonz.ai");
    expect(config.agentName).toBe("my-agent");
    expect(config.defaultUserId).toBe("admin");
    expect(config.contextTokenBudget).toBe(4000);
    expect(config.disable).toEqual({ mood: true, habits: true });
  });

  it("reads agentId from env var", () => {
    process.env.SONZAI_AGENT_ID = "env-agent-id";
    const config = resolveConfig({ apiKey: "sk-test" });
    expect(config.agentId).toBe("env-agent-id");
  });
});
