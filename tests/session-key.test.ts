import { describe, it, expect } from "vitest";
import { parseSessionKey } from "../src/session-key.js";

describe("parseSessionKey", () => {
  const defaultUser = "owner";

  it("parses CLI 1:1 session key", () => {
    const result = parseSessionKey("agent:abc123:mainKey", defaultUser);
    expect(result).toEqual({
      agentId: "abc123",
      userId: "owner",
      channel: null,
      sessionType: "cli",
    });
  });

  it("parses DM session key with channel", () => {
    const result = parseSessionKey(
      "agent:abc123:telegram:direct:456",
      defaultUser,
    );
    expect(result).toEqual({
      agentId: "abc123",
      userId: "456",
      channel: "telegram",
      sessionType: "dm",
    });
  });

  it("parses DM session key with compound peerId", () => {
    const result = parseSessionKey(
      "agent:abc123:whatsapp:direct:+15551234567",
      defaultUser,
    );
    expect(result).toEqual({
      agentId: "abc123",
      userId: "+15551234567",
      channel: "whatsapp",
      sessionType: "dm",
    });
  });

  it("parses group session key", () => {
    const result = parseSessionKey(
      "agent:abc123:discord:group:guild789",
      defaultUser,
    );
    expect(result).toEqual({
      agentId: "abc123",
      userId: "guild789",
      channel: "discord",
      sessionType: "group",
    });
  });

  it("parses cron session key", () => {
    const result = parseSessionKey("cron:daily-check", defaultUser);
    expect(result).toEqual({
      agentId: null,
      userId: "owner",
      channel: null,
      sessionType: "cron",
    });
  });

  it("parses webhook session key", () => {
    const result = parseSessionKey("hook:some-uuid", defaultUser);
    expect(result).toEqual({
      agentId: null,
      userId: "owner",
      channel: null,
      sessionType: "webhook",
    });
  });

  it("falls back to unknown for unrecognized format", () => {
    const result = parseSessionKey("something:weird", defaultUser);
    expect(result).toEqual({
      agentId: null,
      userId: "owner",
      channel: null,
      sessionType: "unknown",
    });
  });

  it("uses custom default userId", () => {
    const result = parseSessionKey("agent:abc123:mainKey", "custom-user");
    expect(result.userId).toBe("custom-user");
  });

  it("handles DM key with per-account-channel-peer format", () => {
    const result = parseSessionKey(
      "agent:abc123:telegram:acct1:direct:user789",
      defaultUser,
    );
    // "direct" is at index 4, peerId is everything after
    expect(result.sessionType).toBe("dm");
    expect(result.userId).toBe("user789");
  });
});
