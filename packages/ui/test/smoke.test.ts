import { describe, expect, it } from "vitest";

import { appName } from "../src/app.js";

describe("ui smoke", () => {
  it("exports the application name", () => {
    expect(appName).toBe("LAICron");
  });
});
