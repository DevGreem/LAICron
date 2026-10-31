import { describe, expect, it } from "vitest";

import {
  formatDateTime,
  formatDuration,
  RUN_STATUS_LABELS,
  RUN_TRIGGER_LABELS,
  scheduleSummary,
} from "../src/format.js";
import { parseRoute, routeKey } from "../src/router.js";
import { tokenFromHash } from "../src/token.js";

describe("hash router", () => {
  it("maps the empty hash and root to the list", () => {
    expect(parseRoute("")).toEqual({ name: "list" });
    expect(parseRoute("#/")).toEqual({ name: "list" });
    expect(parseRoute("#token=abc")).toEqual({ name: "list" });
  });

  it("maps the creation route", () => {
    expect(parseRoute("#/new")).toEqual({ name: "new" });
  });

  it("maps detail and edit routes with decoded ids", () => {
    expect(parseRoute("#/jobs/abc")).toEqual({ name: "detail", id: "abc" });
    expect(parseRoute("#/jobs/a%20b/edit")).toEqual({ name: "edit", id: "a b" });
  });

  it("rejects unknown or malformed routes", () => {
    expect(parseRoute("#/nope")).toEqual({ name: "missing" });
    expect(parseRoute("#/jobs")).toEqual({ name: "missing" });
    expect(parseRoute("#/jobs/%E0%A4%A")).toEqual({ name: "missing" });
  });

  it("builds stable route keys", () => {
    expect(routeKey({ name: "detail", id: "abc" })).toBe("detail:abc");
    expect(routeKey({ name: "list" })).toBe("list");
  });
});

describe("token parsing", () => {
  it("extracts the token from the launcher fragment", () => {
    expect(tokenFromHash("#token=abc123")).toBe("abc123");
    expect(tokenFromHash("token=abc123")).toBe("abc123");
    expect(tokenFromHash("#foo=1&token=abc123")).toBe("abc123");
  });

  it("ignores empty or unrelated fragments", () => {
    expect(tokenFromHash("")).toBeNull();
    expect(tokenFromHash("#token=")).toBeNull();
    expect(tokenFromHash("#/jobs/abc")).toBeNull();
  });
});

describe("formatting", () => {
  it("formats durations in Spanish units", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(500)).toBe("500 ms");
    expect(formatDuration(1500)).toBe("2 s");
    expect(formatDuration(65_000)).toBe("1 min 5 s");
    expect(formatDuration(3_600_000)).toBe("1 h");
    expect(formatDuration(3_900_000)).toBe("1 h 5 min");
  });

  it("formats dates and tolerates missing values", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime(0)).not.toBe("—");
  });

  it("summarizes every schedule kind", () => {
    expect(
      scheduleSummary({ scheduleKind: "cron", scheduleExpr: "0 9 * * 1-5", timezone: "UTC" }),
    ).toBe("Cron 0 9 * * 1-5");
    expect(
      scheduleSummary({ scheduleKind: "interval", scheduleExpr: "15m", timezone: "UTC" }),
    ).toBe("Cada 15 minutos");
    expect(scheduleSummary({ scheduleKind: "interval", scheduleExpr: "1h", timezone: "UTC" })).toBe(
      "Cada 1 hora",
    );
    expect(
      scheduleSummary({
        scheduleKind: "once",
        scheduleExpr: "2030-01-02T03:04:00.000Z",
        timezone: "UTC",
      }),
    ).toContain("Una vez:");
  });

  it("translates every run status", () => {
    expect(RUN_STATUS_LABELS).toEqual({
      queued: "En cola",
      running: "En curso",
      success: "Correcta",
      failed: "Fallida",
      timeout: "Agotada",
      skipped: "Omitida",
      interrupted: "Interrumpida",
    });
  });

  it("translates every run trigger", () => {
    expect(RUN_TRIGGER_LABELS).toEqual({
      scheduled: "Programada",
      catch_up: "Recuperada",
      manual: "Manual",
    });
  });
});
