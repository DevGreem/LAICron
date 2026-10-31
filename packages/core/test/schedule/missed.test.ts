import { describe, expect, it } from "vitest";

import { countMissedRuns } from "../../src/schedule/index.js";

const MADRID = "Europe/Madrid";

describe("countMissedRuns", () => {
  it("counts five daily occurrences and caps the result", () => {
    const job = { scheduleKind: "cron" as const, scheduleExpr: "0 9 * * *", timezone: MADRID };
    const firstMissed = Date.parse("2026-07-01T07:00:00.000Z");
    const now = Date.parse("2026-07-05T07:00:00.000Z");

    expect(countMissedRuns(job, firstMissed, now, 10)).toBe(5);
    expect(countMissedRuns(job, firstMissed, now, 3)).toBe(3);
    expect(countMissedRuns(job, firstMissed, now, 0)).toBe(0);
  });

  it("includes both endpoints of the window", () => {
    const job = { scheduleKind: "cron" as const, scheduleExpr: "0 9 * * *", timezone: MADRID };
    const occurrence = Date.parse("2026-07-01T07:00:00.000Z");

    expect(countMissedRuns(job, occurrence, occurrence, 10)).toBe(1);
    expect(countMissedRuns(job, occurrence, occurrence - 1, 10)).toBe(0);
  });

  it("counts interval runs with arithmetic instead of a loop", () => {
    const job = { scheduleKind: "interval" as const, scheduleExpr: "1m", timezone: MADRID };
    const created = Date.parse("2026-07-01T00:00:00.000Z");
    // First missed run is one minute after creation; the window covers 180
    // scheduled runs (up to three hours after creation, inclusive).
    const firstMissed = created + 60_000;
    const now = created + 3 * 3_600_000;

    expect(countMissedRuns(job, firstMissed, now, 200)).toBe(180);
    expect(countMissedRuns(job, firstMissed, now, 50)).toBe(50);
  });

  it("handles one-shot schedules", () => {
    const job = {
      scheduleKind: "once" as const,
      scheduleExpr: "2026-11-01T09:00:00.000Z",
      timezone: MADRID,
    };
    const target = Date.parse("2026-11-01T09:00:00.000Z");

    expect(countMissedRuns(job, target, target + 60_000, 10)).toBe(1);
    expect(countMissedRuns(job, target + 60_000, target, 10)).toBe(0);
    expect(countMissedRuns(job, target, target + 60_000, 0)).toBe(0);
  });

  it("stops at the cap without walking the whole range", () => {
    const job = { scheduleKind: "cron" as const, scheduleExpr: "* * * * *", timezone: MADRID };
    const firstMissed = Date.parse("2026-07-01T00:00:00.000Z");

    expect(countMissedRuns(job, firstMissed, firstMissed + 10 * 86_400_000, 7)).toBe(7);
  });
});
