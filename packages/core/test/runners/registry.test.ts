import { describe, expect, it } from "vitest";

import { createRunnerRegistry } from "../../src/runners/index.js";

describe("runner registry", () => {
  it("returns the shell runner", () => {
    expect(createRunnerRegistry().get("shell").kind).toBe("shell");
  });

  it("returns the opencode runner", () => {
    expect(createRunnerRegistry().get("opencode").kind).toBe("opencode");
  });
});
