import { describe, it, expect } from "vitest";
import { stripInjectedContext } from "../src/strip-context.js";
import { CONTEXT_BOUNDARY } from "../src/context-builder.js";

describe("stripInjectedContext", () => {
  it("returns content unchanged when no boundary present", () => {
    expect(stripInjectedContext("hello world")).toBe("hello world");
  });

  it("returns empty string unchanged", () => {
    expect(stripInjectedContext("")).toBe("");
  });

  it("strips everything up to and including the boundary", () => {
    const input = `<sonzai-context>\n## Personality\nName: Luna\n</sonzai-context>\n${CONTEXT_BOUNDARY}\nWhat is my favorite food?`;
    expect(stripInjectedContext(input)).toBe("What is my favorite food?");
  });

  it("strips leading whitespace after boundary", () => {
    const input = `injected${CONTEXT_BOUNDARY}   \n  actual question`;
    expect(stripInjectedContext(input)).toBe("actual question");
  });

  it("uses the last boundary when multiple present", () => {
    const input = `${CONTEXT_BOUNDARY}first turn${CONTEXT_BOUNDARY}second turn`;
    expect(stripInjectedContext(input)).toBe("second turn");
  });

  it("preserves boundary character inside legitimate content", () => {
    const input = "I love café";
    expect(stripInjectedContext(input)).toBe("I love café");
  });

  it("does not false-strip on text containing a ZWSP but not the full sentinel", () => {
    expect(stripInjectedContext("hello​world")).toBe("hello​world");
  });
});
