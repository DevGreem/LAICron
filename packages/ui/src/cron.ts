import { t } from "./i18n.js";
import type { MessageKey } from "./i18n.js";

export interface CronFields {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
}

export interface CronPreset {
  id: string;
  readonly label: string;
  expr: string;
}

function preset(id: string, labelKey: MessageKey, expr: string): CronPreset {
  return {
    id,
    get label(): string {
      return t(labelKey);
    },
    expr,
  };
}

export const CRON_PRESETS: CronPreset[] = [
  preset("daily-9", "cron.preset.daily9", "0 9 * * *"),
  preset("weekdays-9", "cron.preset.weekdays9", "0 9 * * 1-5"),
  preset("monday-8", "cron.preset.monday8", "0 8 * * 1"),
  preset("hourly", "cron.preset.hourly", "0 * * * *"),
  preset("every-15", "cron.preset.every15", "*/15 * * * *"),
  preset("monthly-1", "cron.preset.monthly1", "0 0 1 * *"),
];

const DAY_NAMES: readonly MessageKey[] = [
  "cron.day.0",
  "cron.day.1",
  "cron.day.2",
  "cron.day.3",
  "cron.day.4",
  "cron.day.5",
  "cron.day.6",
];

const DAY_PLURALS: readonly MessageKey[] = [
  "cron.days.0",
  "cron.days.1",
  "cron.days.2",
  "cron.days.3",
  "cron.days.4",
  "cron.days.5",
  "cron.days.6",
];

/** Splits a five-field cron expression; returns null when it cannot be split. */
export function parseCron(expr: string): CronFields | null {
  if (typeof expr !== "string") {
    return null;
  }

  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5 || parts.some((part) => part.length === 0)) {
    return null;
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  if (
    minute === undefined ||
    hour === undefined ||
    dayOfMonth === undefined ||
    month === undefined ||
    dayOfWeek === undefined
  ) {
    return null;
  }

  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

/** Joins the five fields with a single space, trimming every field first. */
export function composeCron(fields: CronFields): string {
  return [fields.minute, fields.hour, fields.dayOfMonth, fields.month, fields.dayOfWeek]
    .map((field) => field.trim())
    .join(" ");
}

function normalizeField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numericField(value: string, min: number, max: number): number | null {
  if (!/^\d{1,2}$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return parsed >= min && parsed <= max ? parsed : null;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Builds a short description of the five fields in the current locale.
 * It never throws: unknown shapes fall back to the raw expression.
 */
export function describeCron(fields: CronFields): string {
  try {
    const minute = normalizeField(fields.minute);
    const hour = normalizeField(fields.hour);
    const dayOfMonth = normalizeField(fields.dayOfMonth);
    const month = normalizeField(fields.month);
    const dayOfWeek = normalizeField(fields.dayOfWeek);
    const expr = [minute, hour, dayOfMonth, month, dayOfWeek].join(" ").trim();

    if (
      minute === "*" &&
      hour === "*" &&
      dayOfMonth === "*" &&
      month === "*" &&
      dayOfWeek === "*"
    ) {
      return t("cron.everyMinute");
    }

    const step = /^\*\/(\d{1,2})$/.exec(minute);
    if (step !== null && hour === "*") {
      const amount = Number(step[1]);
      if (amount >= 1 && amount <= 59) {
        return amount === 1 ? t("cron.everyMinute") : t("cron.everyNMinutes", { amount });
      }
    }

    const minuteNumber = numericField(minute, 0, 59);
    const hourNumber = numericField(hour, 0, 23);
    if (minuteNumber !== null && hourNumber !== null && dayOfMonth === "*" && month === "*") {
      const time = `${pad2(hourNumber)}:${pad2(minuteNumber)}`;

      if (dayOfWeek === "*") {
        return t("cron.everyDayAt", { time });
      }

      const range = /^([0-6])-([0-6])$/.exec(dayOfWeek);
      if (range !== null) {
        const startKey = DAY_NAMES[Number(range[1])];
        const endKey = DAY_NAMES[Number(range[2])];
        if (startKey !== undefined && endKey !== undefined) {
          return t("cron.fromToAt", { from: t(startKey), to: t(endKey), time });
        }
      }

      const single = /^[0-6]$/.exec(dayOfWeek);
      if (single !== null) {
        const dayKey = DAY_PLURALS[Number(single[0])];
        if (dayKey !== undefined) {
          return t("cron.everyDayOfWeekAt", { day: t(dayKey), time });
        }
      }
    }

    return t("cron.expression", { expr }).trim();
  } catch {
    return t("cron.invalidExpression");
  }
}
