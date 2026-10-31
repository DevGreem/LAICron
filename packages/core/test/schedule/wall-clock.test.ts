import { describe, expect, it } from "vitest";

import { localWallClock, ScheduleError } from "../../src/schedule/index.js";

const MADRID = "Europe/Madrid";

describe("localWallClock", () => {
  it("formats summer and winter time in Madrid", () => {
    expect(localWallClock(Date.parse("2026-07-14T07:00:00.000Z"), MADRID)).toBe("2026-07-14T09:00");
    expect(localWallClock(Date.parse("2026-01-15T08:00:00.000Z"), MADRID)).toBe("2026-01-15T09:00");
  });

  it("formats UTC without shifting", () => {
    expect(localWallClock(Date.parse("2026-01-15T08:00:00.000Z"), "UTC")).toBe("2026-01-15T08:00");
  });

  it("normalizes midnight to 00 instead of 24", () => {
    expect(localWallClock(Date.parse("2026-01-15T23:00:00.000Z"), MADRID)).toBe("2026-01-16T00:00");
  });

  it("shows both passes of the repeated fall-back hour", () => {
    expect(localWallClock(Date.parse("2026-10-25T00:30:00.000Z"), MADRID)).toBe("2026-10-25T02:30");
    expect(localWallClock(Date.parse("2026-10-25T01:30:00.000Z"), MADRID)).toBe("2026-10-25T02:30");
  });

  it("shows the post-gap wall clock", () => {
    expect(localWallClock(Date.parse("2026-03-29T01:00:00.000Z"), MADRID)).toBe("2026-03-29T03:00");
  });

  it("rejects invalid time zones", () => {
    expect(() => localWallClock(0, "Mars/Olympus")).toThrow(ScheduleError);
  });
});
