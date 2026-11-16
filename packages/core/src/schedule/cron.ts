import { CronExpressionParser } from "cron-parser";

import type { CronSpec } from "./expressions.js";
import { ScheduleError } from "./errors.js";
import { t } from "../i18n.js";
import { findGapAroundLocalDate, formatLocalWallClock, localWallClockParts } from "./wall-clock.js";

const HOUR_MS = 3_600_000;
const MAX_DEDUPE_STEPS = 8;
const MAX_GAP_SKIPS = 4;

/** Next raw cron occurrence strictly after `fromMs`, in UTC epoch ms. */
export function rawNextCron(spec: CronSpec, timezone: string, fromMs: number): number {
  try {
    const iterator = CronExpressionParser.parse(spec.expression, {
      tz: timezone,
      currentDate: new Date(fromMs),
    });
    return iterator.next().toDate().getTime();
  } catch {
    throw new ScheduleError(
      "scheduleExpr",
      t("schedule.nextRunInvalid", { expression: spec.expression }),
    );
  }
}

type GapDecision = number | "skip" | null;

/**
 * Resolves spring-forward gaps for a raw cron-parser candidate.
 *
 * cron-parser shifts a request that falls in a missing wall-clock interval by
 * the size of the gap (02:30 becomes 03:30). The contract wants a single run
 * at the first valid instant instead (03:00, the transition), so:
 *
 * - a shifted candidate whose collapsed run is still ahead is replaced by the
 *   transition instant;
 * - a shifted candidate whose collapsed run already happened is skipped
 *   entirely, so the gap never duplicates a run;
 * - when a job has both a missing time and a valid later time on the same day
 *   (`30 2,3 * * *`), the transition is emitted before the valid candidate.
 *
 * Legitimate candidates are never touched: the correction only runs when an
 * allowed wall time of this job falls inside the missing interval.
 */
function evaluateGap(spec: CronSpec, timezone: string, fromMs: number, rawMs: number): GapDecision {
  const { hours, minutes } = spec;
  if (hours === null || minutes === null) {
    return null;
  }

  const local = localWallClockParts(rawMs, timezone);
  const localDateUtcMs = Date.UTC(local.year, local.month - 1, local.day);
  const gap = findGapAroundLocalDate(localDateUtcMs, timezone);
  if (gap === null || gap.startInstant > rawMs) {
    return null;
  }

  let gapRequested = false;
  for (const hour of hours) {
    for (const minute of minutes) {
      const wallMs = Date.UTC(local.year, local.month - 1, local.day, hour, minute);
      if (wallMs >= gap.wallStartMs && wallMs < gap.wallEndMs) {
        gapRequested = true;
        break;
      }
    }
    if (gapRequested) {
      break;
    }
  }
  if (!gapRequested) {
    return null;
  }

  const candidateIsRequested = hours.includes(local.hour) && minutes.includes(local.minute);

  if (!candidateIsRequested) {
    // The candidate is cron-parser's shifted version of a missing wall time.
    return gap.startInstant > fromMs ? gap.startInstant : "skip";
  }

  // The candidate is legitimate; a missing wall time of the same day was
  // collapsed with it, so the transition instant goes first.
  if (gap.startInstant > fromMs && gap.startInstant < rawMs) {
    return gap.startInstant;
  }
  return null;
}

/** Next normalized occurrence strictly after `fromMs`. */
export function nextCronOccurrence(spec: CronSpec, timezone: string, fromMs: number): number {
  let cursor = fromMs;

  for (let attempt = 0; attempt < MAX_GAP_SKIPS; attempt += 1) {
    const raw = rawNextCron(spec, timezone, cursor);
    const decision = evaluateGap(spec, timezone, cursor, raw);
    if (decision === null) {
      return raw;
    }
    if (decision === "skip") {
      cursor = raw;
      continue;
    }
    return decision;
  }

  return rawNextCron(spec, timezone, cursor);
}

/**
 * Collapses the repeated local hour of a fall-back transition. When the last
 * run happened during the first pass of the repeated hour, any candidate in
 * the second pass shares its wall clock and is less than one hour away; it is
 * skipped so the job does not run twice. The boundary is inclusive because in
 * Europe/Madrid the two 02:30 occurrences are exactly 3_600_000 ms apart.
 */
export function dedupeRepeatedHour(
  spec: CronSpec,
  timezone: string,
  candidateMs: number,
  lastRunAtMs: number,
): number {
  const lastWallClock = formatLocalWallClock(lastRunAtMs, timezone);
  let candidate = candidateMs;

  for (let step = 0; step < MAX_DEDUPE_STEPS; step += 1) {
    const distance = candidate - lastRunAtMs;
    if (distance <= 0 || distance > HOUR_MS) {
      break;
    }
    if (formatLocalWallClock(candidate, timezone) !== lastWallClock) {
      break;
    }
    candidate = nextCronOccurrence(spec, timezone, candidate);
  }

  return candidate;
}

/** Counts cron occurrences in [firstMissedMs, nowMs], capped at `cap`. */
export function countCronOccurrences(
  spec: CronSpec,
  timezone: string,
  firstMissedMs: number,
  nowMs: number,
  cap: number,
): number {
  let cursor = firstMissedMs - 1;
  let count = 0;
  let previous: number | null = null;

  while (count < cap) {
    let occurrence: number;
    try {
      occurrence = nextCronOccurrence(spec, timezone, cursor);
    } catch {
      break;
    }
    if (!Number.isFinite(occurrence) || occurrence <= cursor || occurrence > nowMs) {
      break;
    }

    // Defensive dedupe in case an occurrence list ever contains both passes
    // of a repeated wall clock.
    const previousWall = previous === null ? null : formatLocalWallClock(previous, timezone);
    const duplicated =
      previous !== null &&
      previousWall !== null &&
      occurrence - previous <= HOUR_MS &&
      formatLocalWallClock(occurrence, timezone) === previousWall;

    if (!duplicated) {
      count += 1;
    }
    previous = occurrence;
    cursor = occurrence;

    if (cursor >= nowMs) {
      break;
    }
  }

  return count;
}
