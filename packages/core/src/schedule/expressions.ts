import { CronExpressionParser } from "cron-parser";

import type { ScheduleKind } from "../types.js";
import { ScheduleError } from "./errors.js";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

const INTERVAL_PATTERN = /^([0-9]+)([mh])$/;
// An instant is mandatory: a date without an offset would be ambiguous.
const ONCE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export function assertScheduleKind(kind: string): asserts kind is ScheduleKind {
  if (kind !== "cron" && kind !== "interval" && kind !== "once") {
    throw new ScheduleError(
      "scheduleKind",
      `El tipo de repetición "${kind}" no es válido; debe ser cron, interval u once.`,
    );
  }
}

/**
 * Expands a simple cron field (numbers, `*`, ranges, steps and lists) into the
 * values it matches. Returns null when the syntax is unsupported, in which
 * case DST gap correction is skipped instead of guessing.
 */
export function expandCronField(field: string, min: number, max: number): number[] | null {
  if (field.length === 0) {
    return null;
  }
  const values = new Set<number>();

  for (const part of field.split(",")) {
    const slash = part.indexOf("/");
    const base = slash === -1 ? part : part.slice(0, slash);
    const stepText = slash === -1 ? null : part.slice(slash + 1);

    let step = 1;
    if (stepText !== null) {
      if (!/^[0-9]+$/.test(stepText)) {
        return null;
      }
      step = Number(stepText);
      if (!Number.isInteger(step) || step < 1) {
        return null;
      }
    }

    let start: number;
    let end: number;
    if (base === "*") {
      start = min;
      end = max;
    } else if (/^[0-9]+$/.test(base)) {
      start = Number(base);
      end = stepText === null ? start : max;
    } else {
      const range = /^([0-9]+)-([0-9]+)$/.exec(base);
      if (range === null) {
        return null;
      }
      start = Number(range[1]);
      end = Number(range[2]);
    }

    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < min ||
      end > max ||
      start > end
    ) {
      return null;
    }

    for (let value = start; value <= end; value += step) {
      values.add(value);
    }
  }

  return [...values].sort((left, right) => left - right);
}

export interface CronSpec {
  expression: string;
  hours: number[] | null;
  minutes: number[] | null;
}

/** Validates the five-field cron syntax and extracts the hour/minute sets. */
export function parseCronSpec(expression: string, timezone: string): CronSpec {
  const trimmed = expression.trim();
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    throw new ScheduleError(
      "scheduleExpr",
      "La expresión cron debe tener exactamente cinco campos (minuto hora día mes día-semana).",
    );
  }
  try {
    // Parsing is enough to validate the syntax; the next occurrence is
    // computed later with the real reference instant.
    CronExpressionParser.parse(trimmed, { tz: timezone, currentDate: new Date(0) });
  } catch {
    throw new ScheduleError("scheduleExpr", `La expresión cron "${expression}" no es válida.`);
  }

  return {
    expression: trimmed,
    hours: expandCronField(fields[1] ?? "", 0, 23),
    minutes: expandCronField(fields[0] ?? "", 0, 59),
  };
}

/** Parses `<n>m` / `<n>h` and returns the step in milliseconds. */
export function parseInterval(expression: string): number {
  const match = INTERVAL_PATTERN.exec(expression.trim());
  if (match === null) {
    throw new ScheduleError(
      "scheduleExpr",
      "El intervalo debe tener el formato <n>m o <n>h, por ejemplo 15m o 2h.",
    );
  }
  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount) || amount < 1) {
    throw new ScheduleError("scheduleExpr", "El intervalo debe ser un entero mayor o igual que 1.");
  }
  return amount * (match[2] === "h" ? HOUR_MS : MINUTE_MS);
}

/** Parses an ISO-8601 instant with an explicit offset or `Z`. */
export function parseOnceInstant(expression: string): number {
  const trimmed = expression.trim();
  if (!ONCE_PATTERN.test(trimmed)) {
    throw new ScheduleError(
      "scheduleExpr",
      "La ejecución única necesita una fecha ISO-8601 con zona horaria explícita (Z u offset).",
    );
  }
  const instant = Date.parse(trimmed);
  if (!Number.isFinite(instant)) {
    throw new ScheduleError("scheduleExpr", `La fecha "${expression}" no es válida.`);
  }
  return instant;
}
