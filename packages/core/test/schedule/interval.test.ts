import { describe, expect, it } from "vitest";

import { computeNextRun } from "../../src/schedule/index.js";

const MADRID = "Europe/Madrid";

describe("computeNextRun with intervals", () => {
  it("adds exact minutes", () => {
    const from = Date.parse("2026-01-14T12:00:00.000Z");

    expect(
      computeNextRun({ scheduleKind: "interval", scheduleExpr: "15m", timezone: MADRID }, from),
    ).toBe(from + 15 * 60_000);
  });

  it("adds exact hours", () => {
    const from = Date.parse("2026-01-14T12:00:00.000Z");

    expect(
      computeNextRun({ scheduleKind: "interval", scheduleExpr: "2h", timezone: MADRID }, from),
    ).toBe(from + 2 * 3_600_000);
  });

  it("does not add or remove real time when crossing a spring-forward gap", () => {
    const from = Date.parse("2026-03-29T00:50:00.000Z");
    const next = computeNextRun(
      { scheduleKind: "interval", scheduleExpr: "15m", timezone: MADRID },
      from,
    );

    expect(next).not.toBeNull();
    expect((next ?? 0) - from).toBe(15 * 60_000);
  });

  it("does not add or remove real time when crossing a fall-back overlap", () => {
    const from = Date.parse("2026-10-24T23:30:00.000Z");
    const next = computeNextRun(
      { scheduleKind: "interval", scheduleExpr: "2h", timezone: MADRID },
      from,
    );

    expect(next).not.toBeNull();
    expect((next ?? 0) - from).toBe(2 * 3_600_000);
    // The wall clock only moves one hour because 02:00-03:00 happens twice.
    expect(next).toBe(Date.parse("2026-10-25T01:30:00.000Z"));
  });

  it("rejects malformed intervals", () => {
    expect(() =>
      computeNextRun({ scheduleKind: "interval", scheduleExpr: "0m", timezone: MADRID }, 0),
    ).toThrow(/intervalo/);
  });
});
