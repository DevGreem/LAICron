import { describe, expect, it } from "vitest";

import { buildOverrides, effectiveState, mergeMcpRows } from "../src/mcp-state.js";

describe("mergeMcpRows", () => {
  it("keeps catalog order, applies saved states and appends unknown servers", () => {
    const rows = mergeMcpRows(
      [
        { name: "github", enabled: true },
        { name: "xerj", enabled: false },
      ],
      { github: "off", ghost: "on" },
    );

    expect(rows).toEqual([
      { name: "github", enabled: true, state: "off" },
      { name: "xerj", enabled: false, state: "inherit" },
      { name: "ghost", enabled: null, state: "on" },
    ]);
  });

  it("keeps a saved state even when the catalog is empty", () => {
    expect(mergeMcpRows([], { xerj: "off" })).toEqual([
      { name: "xerj", enabled: null, state: "off" },
    ]);
  });
});

describe("buildOverrides", () => {
  it("keeps only pinned states and omits inherit", () => {
    expect(
      buildOverrides([
        { name: "github", state: "inherit" },
        { name: "xerj", state: "on" },
        { name: "ghost", state: "off" },
      ]),
    ).toEqual({ xerj: "on", ghost: "off" });
  });

  it("returns an empty object when everything is inherited", () => {
    expect(buildOverrides([{ name: "github", state: "inherit" }])).toEqual({});
  });
});

describe("effectiveState", () => {
  it("resolves inherited rows from the catalog default", () => {
    expect(effectiveState("inherit", true)).toBe("on");
    expect(effectiveState("inherit", false)).toBe("off");
    expect(effectiveState("inherit", null)).toBe("inherit");
  });

  it("keeps pinned rows regardless of the catalog default", () => {
    expect(effectiveState("on", false)).toBe("on");
    expect(effectiveState("off", true)).toBe("off");
  });
});
