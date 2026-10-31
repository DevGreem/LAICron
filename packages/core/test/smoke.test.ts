import { describe, expect, it } from "vitest";

import type { RunnerKind } from "../src/index.js";

describe("core smoke", () => {
  it("re-exports the frozen runner kind contract", () => {
    const kind: RunnerKind = "shell";

    expect(kind).toBe("shell");
  });
});
