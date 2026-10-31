import type { Job, ScheduleKind } from "../types.js";
import {
  countCronOccurrences,
  dedupeRepeatedHour,
  nextCronOccurrence,
  rawNextCron,
} from "./cron.js";
import { ScheduleError } from "./errors.js";
import {
  assertScheduleKind,
  parseCronSpec,
  parseInterval,
  parseOnceInstant,
} from "./expressions.js";
import { assertTimezone, formatLocalWallClock } from "./wall-clock.js";

export { ScheduleError } from "./errors.js";
export type { ScheduleField } from "./errors.js";

type ScheduleJob = Pick<Job, "scheduleKind" | "scheduleExpr" | "timezone">;

interface NextRunOptions {
  lastRunAt?: number | null;
}

function assertInstant(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`"${name}" debe ser un instante en milisegundos.`);
  }
}

/**
 * Validates a schedule before it is persisted. Throws ScheduleError pointing
 * at the faulty field; a `once` schedule in the past is rejected here.
 */
export function validateSchedule(kind: ScheduleKind, expr: string, timezone: string): void {
  assertScheduleKind(kind);
  assertTimezone(timezone);

  switch (kind) {
    case "cron": {
      const spec = parseCronSpec(expr, timezone);
      // Reject impossible dates (for example February 30) up front.
      rawNextCron(spec, timezone, Date.now());
      return;
    }
    case "interval": {
      parseInterval(expr);
      return;
    }
    case "once": {
      const instant = parseOnceInstant(expr);
      if (instant < Date.now()) {
        throw new ScheduleError("scheduleExpr", "La fecha y hora indicadas ya pasaron.");
      }
      return;
    }
  }
}

/**
 * Returns the next execution in UTC epoch milliseconds. Only a consumed
 * `once` schedule returns null; interval and cron always have a next run.
 */
export function computeNextRun(
  job: ScheduleJob,
  fromMs: number,
  opts: NextRunOptions = {},
): number | null {
  assertInstant(fromMs, "fromMs");
  assertScheduleKind(job.scheduleKind);
  assertTimezone(job.timezone);

  switch (job.scheduleKind) {
    case "interval":
      return fromMs + parseInterval(job.scheduleExpr);

    case "once": {
      // Deliberately not calling validateSchedule: a past one-shot is a
      // consumed schedule here, not a validation error.
      const instant = parseOnceInstant(job.scheduleExpr);
      if (instant <= fromMs) {
        return null;
      }
      if (opts.lastRunAt !== undefined && opts.lastRunAt !== null && instant <= opts.lastRunAt) {
        return null;
      }
      return instant;
    }

    case "cron": {
      const spec = parseCronSpec(job.scheduleExpr, job.timezone);
      let next = nextCronOccurrence(spec, job.timezone, fromMs);
      if (opts.lastRunAt !== undefined && opts.lastRunAt !== null) {
        next = dedupeRepeatedHour(spec, job.timezone, next, opts.lastRunAt);
      }
      return next;
    }
  }
}

/**
 * Counts executions in [firstMissedMs, nowMs] without iterating more than
 * `cap` times. Interval schedules use direct arithmetic, never a loop.
 */
export function countMissedRuns(
  job: ScheduleJob,
  firstMissedMs: number,
  nowMs: number,
  cap: number,
): number {
  assertInstant(firstMissedMs, "firstMissedMs");
  assertInstant(nowMs, "nowMs");
  assertScheduleKind(job.scheduleKind);
  assertTimezone(job.timezone);

  const limit = Math.max(0, Math.floor(cap));

  switch (job.scheduleKind) {
    case "once": {
      parseOnceInstant(job.scheduleExpr);
      if (limit === 0 || firstMissedMs > nowMs) {
        return 0;
      }
      return 1;
    }

    case "interval": {
      const step = parseInterval(job.scheduleExpr);
      if (limit === 0 || firstMissedMs > nowMs) {
        return 0;
      }
      const elapsed = nowMs - firstMissedMs;
      const occurrences = Math.floor(elapsed / step) + 1;
      return Math.min(occurrences, limit);
    }

    case "cron": {
      const spec = parseCronSpec(job.scheduleExpr, job.timezone);
      if (limit === 0 || firstMissedMs > nowMs) {
        return 0;
      }
      return countCronOccurrences(spec, job.timezone, firstMissedMs, nowMs, limit);
    }
  }
}

/** Local wall clock of an instant as `YYYY-MM-DDTHH:mm`. */
export function localWallClock(instantMs: number, timezone: string): string {
  assertInstant(instantMs, "instantMs");
  return formatLocalWallClock(instantMs, timezone);
}
