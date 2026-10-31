import { afterEach, describe, expect, it, vi } from "vitest";

import { ScheduleError, validateSchedule } from "../../src/schedule/index.js";
import type { ScheduleKind } from "../../src/types.js";

const MADRID = "Europe/Madrid";

function expectScheduleError(run: () => void, field: string): void {
  try {
    run();
    expect.unreachable("validateSchedule should have thrown");
  } catch (error) {
    expect(error).toBeInstanceOf(ScheduleError);
    if (error instanceof ScheduleError) {
      expect(error.field).toBe(field);
    }
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("validateSchedule", () => {
  it("accepts the three supported kinds", () => {
    expect(() => validateSchedule("cron", "0 9 * * 1-5", MADRID)).not.toThrow();
    expect(() => validateSchedule("interval", "15m", MADRID)).not.toThrow();
    expect(() => validateSchedule("interval", "2h", "UTC")).not.toThrow();
    expect(() => validateSchedule("once", "2099-01-01T00:00:00.000Z", MADRID)).not.toThrow();
  });

  it("rejects cron expressions that are not five fields", () => {
    expectScheduleError(() => validateSchedule("cron", "0 9 * *", MADRID), "scheduleExpr");
    expectScheduleError(() => validateSchedule("cron", "0 9 * * * *", MADRID), "scheduleExpr");
    expectScheduleError(() => validateSchedule("cron", "not a cron", MADRID), "scheduleExpr");
  });

  it("rejects cron expressions with out-of-range values", () => {
    expectScheduleError(() => validateSchedule("cron", "61 9 * * *", MADRID), "scheduleExpr");
    expectScheduleError(() => validateSchedule("cron", "0 25 * * *", MADRID), "scheduleExpr");
  });

  it("rejects malformed intervals", () => {
    for (const expression of ["0m", "0h", "15", "1d", "1h30m", "", "-5m", "1.5h"]) {
      expectScheduleError(() => validateSchedule("interval", expression, MADRID), "scheduleExpr");
    }
  });

  it("rejects unknown time zones", () => {
    expectScheduleError(() => validateSchedule("cron", "0 9 * * *", "Mars/Olympus"), "timezone");
    expectScheduleError(() => validateSchedule("cron", "0 9 * * *", ""), "timezone");
    expectScheduleError(() => validateSchedule("cron", "0 9 * * *", "+01:00"), "timezone");
  });

  it("rejects one-shot schedules in the past", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-30T12:00:00.000Z"));

    expectScheduleError(
      () => validateSchedule("once", "2026-10-30T11:59:59.000Z", MADRID),
      "scheduleExpr",
    );
    expect(() => validateSchedule("once", "2026-10-30T12:00:00.000Z", MADRID)).not.toThrow();
  });

  it("rejects unknown schedule kinds", () => {
    expectScheduleError(
      () => validateSchedule("weekly" as ScheduleKind, "0 9 * * *", MADRID),
      "scheduleKind",
    );
  });
});
