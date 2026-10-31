import { afterEach, describe, expect, it, vi } from "vitest";

import { computeNextRun, ScheduleError, validateSchedule } from "../../src/schedule/index.js";

const MADRID = "Europe/Madrid";

afterEach(() => {
  vi.useRealTimers();
});

describe("one-shot schedules", () => {
  it("accepts a future instant and returns it unchanged", () => {
    const target = "2026-11-01T09:00:00.000Z";
    const from = Date.parse("2026-10-30T00:00:00.000Z");

    expect(() => validateSchedule("once", target, MADRID)).not.toThrow();
    expect(
      computeNextRun({ scheduleKind: "once", scheduleExpr: target, timezone: MADRID }, from),
    ).toBe(Date.parse(target));
  });

  it("accepts an instant expressed with an offset", () => {
    // 10:00+01:00 equals 09:00Z.
    expect(
      computeNextRun(
        {
          scheduleKind: "once",
          scheduleExpr: "2026-11-01T10:00:00+01:00",
          timezone: MADRID,
        },
        Date.parse("2026-10-30T00:00:00.000Z"),
      ),
    ).toBe(Date.parse("2026-11-01T09:00:00.000Z"));
  });

  it("rejects a past instant during validation", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-30T12:00:00.000Z"));

    try {
      validateSchedule("once", "2026-10-29T09:00:00.000Z", MADRID);
      expect.unreachable("validateSchedule should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ScheduleError);
      if (error instanceof ScheduleError) {
        expect(error.field).toBe("scheduleExpr");
        expect(error.message).toMatch(/ya pasaron/);
      }
    }
  });

  it("returns null once the instant has been consumed", () => {
    const target = "2026-10-29T09:00:00.000Z";

    expect(
      computeNextRun(
        { scheduleKind: "once", scheduleExpr: target, timezone: MADRID },
        Date.parse(target),
      ),
    ).toBeNull();
    expect(
      computeNextRun(
        { scheduleKind: "once", scheduleExpr: target, timezone: MADRID },
        Date.parse("2026-10-30T00:00:00.000Z"),
      ),
    ).toBeNull();
  });

  it("returns null when the recorded run already consumed it", () => {
    const target = "2026-11-01T09:00:00.000Z";

    expect(
      computeNextRun(
        { scheduleKind: "once", scheduleExpr: target, timezone: MADRID },
        Date.parse("2026-10-30T00:00:00.000Z"),
        { lastRunAt: Date.parse(target) },
      ),
    ).toBeNull();
  });

  it("requires an explicit offset", () => {
    expect(() => validateSchedule("once", "2026-11-01T09:00:00", MADRID)).toThrow(ScheduleError);
  });
});
