import { ScheduleError } from "./errors.js";
import { t } from "../i18n.js";

const HOUR_MS = 3_600_000;

const wallFormatters = new Map<string, Intl.DateTimeFormat>();
const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

function wallFormatter(timezone: string): Intl.DateTimeFormat {
  let formatter = wallFormatters.get(timezone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    wallFormatters.set(timezone, formatter);
  }
  return formatter;
}

function offsetFormatter(timezone: string): Intl.DateTimeFormat {
  let formatter = offsetFormatters.get(timezone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    offsetFormatters.set(timezone, formatter);
  }
  return formatter;
}

function formatParts(instantMs: number, formatter: Intl.DateTimeFormat): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(instantMs))) {
    if (part.type !== "literal") {
      result[part.type] = part.value;
    }
  }
  return result;
}

function numberFrom(parts: Record<string, string>, key: string): number {
  return Number(parts[key] ?? "NaN");
}

/**
 * Rejects values that are not valid IANA time zones. Intl is the source of
 * truth, but bare UTC offsets are rejected because the contract requires an
 * explicit IANA zone per job.
 */
export function assertTimezone(timezone: string): void {
  if (typeof timezone !== "string" || timezone.trim().length === 0) {
    throw new ScheduleError("timezone", t("schedule.timezoneRequired"));
  }
  if (/^[+-]\d{2}:?\d{2}$/.test(timezone.trim())) {
    throw new ScheduleError("timezone", t("schedule.timezoneOffset", { timezone }));
  }
  try {
    wallFormatter(timezone);
  } catch {
    throw new ScheduleError("timezone", t("schedule.timezoneInvalid", { timezone }));
  }
}

export interface LocalWallClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** Returns the local wall-clock components of an instant in a time zone. */
export function localWallClockParts(instantMs: number, timezone: string): LocalWallClockParts {
  const parts = formatParts(instantMs, wallFormatter(timezone));
  return {
    year: numberFrom(parts, "year"),
    month: numberFrom(parts, "month"),
    day: numberFrom(parts, "day"),
    hour: numberFrom(parts, "hour"),
    minute: numberFrom(parts, "minute"),
  };
}

/** Returns `YYYY-MM-DDTHH:mm` for an instant in a time zone. */
export function formatLocalWallClock(instantMs: number, timezone: string): string {
  assertTimezone(timezone);
  const parts = localWallClockParts(instantMs, timezone);
  const year = String(parts.year).padStart(4, "0");
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  const hour = String(parts.hour).padStart(2, "0");
  const minute = String(parts.minute).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

/**
 * UTC offset of a time zone at an instant, in milliseconds. Seconds are
 * enough for DST transitions and avoid millisecond noise in binary searches.
 */
export function timezoneOffsetMs(instantMs: number, timezone: string): number {
  const parts = formatParts(instantMs, offsetFormatter(timezone));
  const secondMs = Math.floor(instantMs / 1000) * 1000;
  const localMs = Date.UTC(
    numberFrom(parts, "year"),
    numberFrom(parts, "month") - 1,
    numberFrom(parts, "day"),
    numberFrom(parts, "hour"),
    numberFrom(parts, "minute"),
    numberFrom(parts, "second"),
  );
  return localMs - secondMs;
}

export interface ClockTransition {
  /** First instant at which the new offset applies. */
  instant: number;
  beforeOffsetMs: number;
  afterOffsetMs: number;
}

function firstInstantWithOffset(
  lo: number,
  hi: number,
  offsetMs: number,
  timezone: string,
): number {
  // Invariant: the offset at `lo` is different from `offsetMs` and the offset at `hi` is `offsetMs`.
  let low = lo;
  let high = hi;
  while (high - low > 1) {
    const mid = low + Math.floor((high - low) / 2);
    if (timezoneOffsetMs(mid, timezone) === offsetMs) {
      high = mid;
    } else {
      low = mid;
    }
  }
  return high;
}

/**
 * Finds the first forward (offset increasing) transition in a window around a
 * local calendar date. The window is wide enough to cover every UTC offset.
 */
export function findForwardTransition(
  localDateUtcMs: number,
  timezone: string,
): ClockTransition | null {
  const scanStart = localDateUtcMs - 15 * HOUR_MS;
  const scanEnd = localDateUtcMs + 39 * HOUR_MS;
  let previousInstant = scanStart;
  let previousOffset = timezoneOffsetMs(scanStart, timezone);

  for (let probe = scanStart + HOUR_MS; probe <= scanEnd; probe += HOUR_MS) {
    const offset = timezoneOffsetMs(probe, timezone);
    if (offset !== previousOffset) {
      const instant = firstInstantWithOffset(previousInstant, probe, offset, timezone);
      const beforeOffset = timezoneOffsetMs(instant - 1, timezone);
      if (offset > beforeOffset) {
        return { instant, beforeOffsetMs: beforeOffset, afterOffsetMs: offset };
      }
      previousInstant = probe;
      previousOffset = offset;
    } else {
      previousInstant = probe;
    }
  }
  return null;
}

export interface GapWindow {
  /** First instant after the gap; the occurrence is moved here. */
  startInstant: number;
  /** Inclusive start of the missing wall-clock interval, as Date.UTC() ms. */
  wallStartMs: number;
  /** Exclusive end of the missing wall-clock interval, as Date.UTC() ms. */
  wallEndMs: number;
}

/**
 * Returns the gap (skipped wall-clock interval) around a local date, if any.
 * Wall times in [wallStartMs, wallEndMs) do not exist in that time zone.
 */
export function findGapAroundLocalDate(localDateUtcMs: number, timezone: string): GapWindow | null {
  const transition = findForwardTransition(localDateUtcMs, timezone);
  if (transition === null) {
    return null;
  }
  return {
    startInstant: transition.instant,
    wallStartMs: transition.instant + transition.beforeOffsetMs,
    wallEndMs: transition.instant + transition.afterOffsetMs,
  };
}
