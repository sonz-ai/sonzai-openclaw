import { describe, it, expect, vi, afterEach } from "vitest";
import { healthCheck } from "../src/setup.js";

describe("healthCheck", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns true on 200", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    expect(await healthCheck("https://api.sonz.ai")).toBe(true);
  });

  it("returns false on 5xx", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false } as Response);
    expect(await healthCheck("https://api.sonz.ai")).toBe(false);
  });

  it("returns false on network error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await healthCheck("https://api.sonz.ai")).toBe(false);
  });

  it("returns false on timeout", async () => {
    // AbortSignal.timeout fires after 5s; simulate by rejecting with AbortError
    global.fetch = vi.fn().mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    expect(await healthCheck("https://api.sonz.ai")).toBe(false);
  });

  it("trims trailing slashes from baseUrl", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    global.fetch = fetchMock;
    await healthCheck("https://api.sonz.ai///");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.sonz.ai/health",
      expect.any(Object),
    );
  });

  it("uses default base url when no arg provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    global.fetch = fetchMock;
    await healthCheck();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.sonz.ai/health",
      expect.any(Object),
    );
  });
});
