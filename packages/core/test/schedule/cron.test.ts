import { describe, expect, it } from "vitest";

import { computeNextRun, localWallClock } from "../../src/schedule/index.js";

const MADRID = "Europe/Madrid";

describe("computeNextRun with cron expressions", () => {
  it("returns the next daily occurrence in summer time", () => {
    const next = computeNextRun(
      { scheduleKind: "cron", scheduleExpr: "0 9 * * *", timezone: MADRID },
      Date.parse("2026-07-14T00:00:00.000Z"),
    );

    // 09:00 CEST is 07:00 UTC.
    expect(next).toBe(Date.parse("2026-07-14T07:00:00.000Z"));
  });

  it("returns the next daily occurrence in winter time", () => {
    const next = computeNextRun(
      { scheduleKind: "cron", scheduleExpr: "0 9 * * *", timezone: MADRID },
      Date.parse("2026-01-14T12:00:00.000Z"),
    );

    // 09:00 CET is 08:00 UTC on the following day.
    expect(next).toBe(Date.parse("2026-01-15T08:00:00.000Z"));
  });

  it("is strictly after the reference instant", () => {
    const next = computeNextRun(
      { scheduleKind: "cron", scheduleExpr: "0 9 * * *", timezone: MADRID },
      Date.parse("2026-07-14T07:00:00.000Z"),
    );

    expect(next).toBe(Date.parse("2026-07-15T07:00:00.000Z"));
  });

  it("honours weekdays", () => {
    // Friday 2026-07-17 18:00 local; next weekday run is Monday 2026-07-20 09:00.
    const next = computeNextRun(
      { scheduleKind: "cron", scheduleExpr: "0 9 * * 1-5", timezone: MADRID },
      Date.parse("2026-07-17T16:00:00.000Z"),
    );

    expect(next).toBe(Date.parse("2026-07-20T07:00:00.000Z"));
    expect(localWallClock(next ?? 0, MADRID)).toBe("2026-07-20T09:00");
  });

  it("deduplicates the repeated wall clock of a fall-back", () => {
    const firstPass = Date.parse("2026-10-25T00:30:00.000Z");
    const betweenPasses = Date.parse("2026-10-25T01:15:00.000Z");

    // Without a reference run, cron-parser can land on the second 02:30.
    expect(
      computeNextRun(
        { scheduleKind: "cron", scheduleExpr: "30 2 * * *", timezone: MADRID },
        betweenPasses,
      ),
    ).toBe(Date.parse("2026-10-25T01:30:00.000Z"));

    // With the first pass recorded, the second pass is skipped.
    expect(
      computeNextRun(
        { scheduleKind: "cron", scheduleExpr: "30 2 * * *", timezone: MADRID },
        betweenPasses,
        { lastRunAt: firstPass },
      ),
    ).toBe(Date.parse("2026-10-26T01:30:00.000Z"));
  });
});
