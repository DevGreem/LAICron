import { describe, expect, it } from "vitest";

import { formatCost, formatTokens } from "../src/format.js";

describe("formatTokens", () => {
  it("formats zero as a plain zero", () => {
    expect(formatTokens(0)).toBe("0");
  });

  it("groups thousands with Spanish separators", () => {
    expect(formatTokens(12345)).toBe("12.345");
  });
});

describe("formatCost", () => {
  it("formats zero with two decimals", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  it("uses four decimals from one cent upwards", () => {
    expect(formatCost(1.2345)).toBe("$1.2345");
  });

  it("uses six decimals for sub-cent amounts", () => {
    expect(formatCost(0.0042)).toBe("$0.004200");
    expect(formatCost(0.0000496)).toBe("$0.000050");
  });
});
