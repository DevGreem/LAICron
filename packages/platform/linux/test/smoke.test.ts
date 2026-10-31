import { describe, expect, it } from "vitest";

import { platform } from "../src/index.js";

describe("platform-linux smoke", () => {
  it("reports the target platform", () => {
    expect(platform).toBe("linux");
  });
});
