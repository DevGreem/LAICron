import { describe, expect, it } from "vitest";

import { composeModelValue, splitModelValue } from "../src/model-value.js";

describe("splitModelValue", () => {
  it("splits a model id and its variant", () => {
    expect(splitModelValue("opencode/deepseek#high")).toEqual({
      base: "opencode/deepseek",
      variant: "high",
    });
  });

  it("splits at the last hash", () => {
    expect(splitModelValue("a#b#c")).toEqual({ base: "a#b", variant: "c" });
  });

  it("returns an empty base for missing values", () => {
    expect(splitModelValue(null)).toEqual({ base: "", variant: null });
    expect(splitModelValue(undefined)).toEqual({ base: "", variant: null });
    expect(splitModelValue("")).toEqual({ base: "", variant: null });
    expect(splitModelValue("   ")).toEqual({ base: "", variant: null });
  });

  it("trims the base and ignores an empty variant", () => {
    expect(splitModelValue("  model  ")).toEqual({ base: "model", variant: null });
    expect(splitModelValue("model#")).toEqual({ base: "model", variant: null });
  });
});

describe("composeModelValue", () => {
  it("joins a base and a variant", () => {
    expect(composeModelValue("m", "low")).toBe("m#low");
  });

  it("omits a missing variant", () => {
    expect(composeModelValue("m", null)).toBe("m");
    expect(composeModelValue("m", "")).toBe("m");
  });

  it("returns null without a base", () => {
    expect(composeModelValue("", "low")).toBeNull();
    expect(composeModelValue("   ", "low")).toBeNull();
  });
});
