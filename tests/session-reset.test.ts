import { describe, it, expect } from "vitest";
import {
  BARE_SESSION_RESET_PROMPT,
  isSessionResetPrompt,
} from "../src/session-reset.js";

describe("isSessionResetPrompt", () => {
  it("returns false for undefined", () => {
    expect(isSessionResetPrompt(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isSessionResetPrompt("")).toBe(false);
  });

  it("returns true for the exact boilerplate prompt", () => {
    expect(isSessionResetPrompt(BARE_SESSION_RESET_PROMPT)).toBe(true);
  });

  it("returns true for minor variation within 20% edit distance", () => {
    const variant = BARE_SESSION_RESET_PROMPT.replace(
      "Keep it to 1-3 sentences and ask what they want to do. ",
      "",
    );
    expect(isSessionResetPrompt(variant)).toBe(true);
  });

  it("returns false for normal user messages", () => {
    expect(isSessionResetPrompt("Hello, how are you?")).toBe(false);
    expect(isSessionResetPrompt("What coffee do I like?")).toBe(false);
    expect(isSessionResetPrompt("Remember: I prefer dark mode.")).toBe(false);
  });

  it("returns false when length differs by more than 20%", () => {
    expect(isSessionResetPrompt("short")).toBe(false);
    expect(isSessionResetPrompt("x".repeat(2000))).toBe(false);
  });

  it("returns false for prompts that share some words but are unrelated", () => {
    const unrelated =
      "A new session of our planning meeting was started - please read the agenda " +
      "and summarize the action items for the team. Keep it brief and mention blockers.";
    expect(isSessionResetPrompt(unrelated)).toBe(false);
  });
});
