import { describe, expect, it } from "vitest";

import { computeNextRun, countMissedRuns } from "../../src/schedule/index.js";

const MADRID = "Europe/Madrid";

describe("daylight saving transitions in Europe/Madrid", () => {
  it("runs once at the first valid instant after a spring-forward gap", () => {
    const next = computeNextRun(
      { scheduleKind: "cron", scheduleExpr: "30 2 * * *", timezone: MADRID },
      Date.parse("2026-03-28T12:00:00.000Z"),
    );

    // 02:30 does not exist on 2026-03-29; the run happens at 03:00 CEST (01:00Z).
    expect(next).toBe(Date.parse("2026-03-29T01:00:00.000Z"));
  });

  it("does not repeat the gap occurrence", () => {
    const gapInstant = Date.parse("2026-03-29T01:00:00.000Z");

    expect(
      computeNextRun(
        { scheduleKind: "cron", scheduleExpr: "30 2 * * *", timezone: MADRID },
        gapInstant,
      ),
    ).toBe(Date.parse("2026-03-30T00:30:00.000Z"));
  });

  it("leaves a cron that already falls after the gap untouched", () => {
    expect(
      computeNextRun(
        { scheduleKind: "cron", scheduleExpr: "30 3 * * *", timezone: MADRID },
        Date.parse("2026-03-28T12:00:00.000Z"),
      ),
    ).toBe(Date.parse("2026-03-29T01:30:00.000Z"));
  });

  it("maps an exact gap boundary to the transition instant", () => {
    expect(
      computeNextRun(
        { scheduleKind: "cron", scheduleExpr: "0 2 * * *", timezone: MADRID },
        Date.parse("2026-03-28T12:00:00.000Z"),
      ),
    ).toBe(Date.parse("2026-03-29T01:00:00.000Z"));
  });

  it("collapses several missing wall times into a single run", () => {
    const job = { scheduleKind: "cron" as const, scheduleExpr: "*/30 2 * * *", timezone: MADRID };

    expect(computeNextRun(job, Date.parse("2026-03-28T12:00:00.000Z"))).toBe(
      Date.parse("2026-03-29T01:00:00.000Z"),
    );
    expect(computeNextRun(job, Date.parse("2026-03-29T01:00:00.000Z"))).toBe(
      Date.parse("2026-03-30T00:00:00.000Z"),
    );
  });

  it("keeps a valid later wall time after the gap run", () => {
    const job = { scheduleKind: "cron" as const, scheduleExpr: "30 2,3 * * *", timezone: MADRID };

    expect(computeNextRun(job, Date.parse("2026-03-28T12:00:00.000Z"))).toBe(
      Date.parse("2026-03-29T01:00:00.000Z"),
    );
    expect(computeNextRun(job, Date.parse("2026-03-29T01:00:00.000Z"))).toBe(
      Date.parse("2026-03-29T01:30:00.000Z"),
    );
    expect(computeNextRun(job, Date.parse("2026-03-29T01:30:00.000Z"))).toBe(
      Date.parse("2026-03-30T00:30:00.000Z"),
    );
  });

  it("counts the gap occurrence only once", () => {
    const missed = countMissedRuns(
      { scheduleKind: "cron", scheduleExpr: "30 2 * * *", timezone: MADRID },
      Date.parse("2026-03-29T01:00:00.000Z"),
      Date.parse("2026-03-30T00:30:00.000Z"),
      10,
    );

    expect(missed).toBe(2);
  });

  it("runs only once during a fall-back overlap", () => {
    const firstPass = computeNextRun(
      { scheduleKind: "cron", scheduleExpr: "30 2 * * *", timezone: MADRID },
      Date.parse("2026-10-24T12:00:00.000Z"),
    );
    expect(firstPass).toBe(Date.parse("2026-10-25T00:30:00.000Z"));

    const afterRun = computeNextRun(
      { scheduleKind: "cron", scheduleExpr: "30 2 * * *", timezone: MADRID },
      firstPass ?? 0,
      { lastRunAt: firstPass },
    );
    expect(afterRun).toBe(Date.parse("2026-10-26T01:30:00.000Z"));
  });

  it("does not double count the repeated wall clock", () => {
    const missed = countMissedRuns(
      { scheduleKind: "cron", scheduleExpr: "30 2 * * *", timezone: MADRID },
      Date.parse("2026-10-25T00:30:00.000Z"),
      Date.parse("2026-10-26T23:59:59.999Z"),
      10,
    );

    expect(missed).toBe(2);
  });
});
