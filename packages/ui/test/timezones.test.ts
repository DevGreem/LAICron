import { describe, expect, it } from "vitest";

import { FALLBACK_TIMEZONES, listTimezones, timezoneInfo } from "../src/timezones.js";

describe("listTimezones", () => {
  it("starts with UTC and has no duplicates", () => {
    const zones = listTimezones();

    expect(zones[0]).toBe("UTC");
    expect(new Set(zones).size).toBe(zones.length);
    expect(zones).toContain("Europe/Madrid");
  });

  it("provides a fallback catalogue with frequent IANA zones", () => {
    expect(FALLBACK_TIMEZONES.length).toBeGreaterThanOrEqual(30);
    expect(FALLBACK_TIMEZONES).toContain("UTC");
    expect(FALLBACK_TIMEZONES).toContain("Europe/Madrid");
    expect(FALLBACK_TIMEZONES).toContain("America/Santo_Domingo");
    expect(FALLBACK_TIMEZONES).toContain("Asia/Tokyo");
  });
});

describe("timezoneInfo", () => {
  it("formats the current UTC time and offset", () => {
    const info = timezoneInfo("UTC");

    expect(info.time).toMatch(/^\d{2}:\d{2}$/);
    expect(info.offset).toMatch(/GMT|UTC/);
  });

  it("applies the winter offset in Madrid", () => {
    expect(timezoneInfo("Europe/Madrid", new Date("2026-01-15T12:00:00Z"))).toEqual({
      time: "13:00",
      offset: "GMT+1",
    });
  });

  it("reports invalid zones without throwing", () => {
    expect(timezoneInfo("No/Existe")).toEqual({ time: "--:--", offset: "zona no válida" });
  });
});
