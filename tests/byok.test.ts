import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerByokKeys } from "../src/byok.js";
import type { ResolvedConfig } from "../src/config.js";

function baseConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    apiKey: "sk-test",
    agentId: undefined,
    baseUrl: "https://api.sonz.ai",
    agentName: "openclaw-agent",
    defaultUserId: "owner",
    contextTokenBudget: 2000,
    disable: {},
    extractionProvider: undefined,
    extractionModel: undefined,
    memoryMode: "sync",
    projectId: undefined,
    byok: {},
    ...overrides,
  };
}

function makeClient(overrides: {
  byokSet?: ReturnType<typeof vi.fn>;
  projectsList?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    byok: { set: overrides.byokSet ?? vi.fn().mockResolvedValue({}) },
    projects: {
      list:
        overrides.projectsList ??
        vi.fn().mockResolvedValue({ items: [], has_more: false }),
    },
  } as never;
}

describe("registerByokKeys", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("is a no-op when no byok keys configured", async () => {
    const client = makeClient();
    const out = await registerByokKeys(client, baseConfig());
    expect(out).toEqual([]);
    expect((client as { projects: { list: ReturnType<typeof vi.fn> } }).projects.list).not.toHaveBeenCalled();
    expect((client as { byok: { set: ReturnType<typeof vi.fn> } }).byok.set).not.toHaveBeenCalled();
  });

  it("uses configured projectId without calling projects.list", async () => {
    const byokSet = vi.fn().mockResolvedValue({});
    const projectsList = vi.fn();
    const client = makeClient({ byokSet, projectsList });
    const out = await registerByokKeys(
      client,
      baseConfig({ projectId: "proj-x", byok: { openai: "sk-1" } }),
    );
    expect(out).toEqual(["openai"]);
    expect(projectsList).not.toHaveBeenCalled();
    expect(byokSet).toHaveBeenCalledWith("proj-x", "openai", "sk-1");
  });

  it("auto-discovers the project named Default", async () => {
    const byokSet = vi.fn().mockResolvedValue({});
    const projectsList = vi.fn().mockResolvedValue({
      items: [
        { project_id: "proj-other", name: "Staging" },
        { project_id: "proj-default", name: "Default" },
      ],
      has_more: false,
    });
    const client = makeClient({ byokSet, projectsList });
    const out = await registerByokKeys(
      client,
      baseConfig({ byok: { gemini: "sk-g" } }),
    );
    expect(out).toEqual(["gemini"]);
    expect(byokSet).toHaveBeenCalledWith("proj-default", "gemini", "sk-g");
  });

  it("uses the sole project when no Default exists and only one is visible", async () => {
    const byokSet = vi.fn().mockResolvedValue({});
    const projectsList = vi.fn().mockResolvedValue({
      items: [{ project_id: "proj-only", name: "Production" }],
      has_more: false,
    });
    const client = makeClient({ byokSet, projectsList });
    const out = await registerByokKeys(
      client,
      baseConfig({ byok: { xai: "sk-x" } }),
    );
    expect(out).toEqual(["xai"]);
    expect(byokSet).toHaveBeenCalledWith("proj-only", "xai", "sk-x");
  });

  it("skips registration when projectId cannot be resolved", async () => {
    const byokSet = vi.fn();
    const projectsList = vi.fn().mockResolvedValue({
      items: [
        { project_id: "p1", name: "Staging" },
        { project_id: "p2", name: "Production" },
      ],
      has_more: false,
    });
    const client = makeClient({ byokSet, projectsList });
    const out = await registerByokKeys(
      client,
      baseConfig({ byok: { openai: "sk-1" } }),
    );
    expect(out).toEqual([]);
    expect(byokSet).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("could not resolve projectId"),
    );
  });

  it("registers multiple providers in parallel and reports per-provider failures", async () => {
    const byokSet = vi
      .fn()
      .mockImplementation(async (_pid: string, provider: string) => {
        if (provider === "gemini") throw new Error("boom");
        return {};
      });
    const client = makeClient({ byokSet });
    const out = await registerByokKeys(
      client,
      baseConfig({
        projectId: "proj",
        byok: { openai: "sk-o", gemini: "sk-g", xai: "sk-x" },
      }),
    );
    expect(out.sort()).toEqual(["openai", "xai"]);
    expect(byokSet).toHaveBeenCalledTimes(3);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("failed to register gemini"),
    );
  });
});
