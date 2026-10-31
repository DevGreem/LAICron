export interface CronFields {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
}

export interface CronPreset {
  id: string;
  label: string;
  expr: string;
}

export const CRON_PRESETS: CronPreset[] = [
  { id: "daily-9", label: "Cada día a las 09:00", expr: "0 9 * * *" },
  { id: "weekdays-9", label: "De lunes a viernes a las 09:00", expr: "0 9 * * 1-5" },
  { id: "monday-8", label: "Cada lunes a las 08:00", expr: "0 8 * * 1" },
  { id: "hourly", label: "Cada hora en punto", expr: "0 * * * *" },
  { id: "every-15", label: "Cada 15 minutos", expr: "*/15 * * * *" },
  { id: "monthly-1", label: "El primer día del mes a las 00:00", expr: "0 0 1 * *" },
];

const DAY_NAMES = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
] as const;

const DAY_PLURALS = [
  "domingos",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábados",
] as const;

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
 * Builds a short Spanish description of the five fields.
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
      return "cada minuto";
    }

    const step = /^\*\/(\d{1,2})$/.exec(minute);
    if (step !== null && hour === "*") {
      const amount = Number(step[1]);
      if (amount >= 1 && amount <= 59) {
        return amount === 1 ? "cada minuto" : `cada ${amount} minutos`;
      }
    }

    const minuteNumber = numericField(minute, 0, 59);
    const hourNumber = numericField(hour, 0, 23);
    if (minuteNumber !== null && hourNumber !== null && dayOfMonth === "*" && month === "*") {
      const time = `${pad2(hourNumber)}:${pad2(minuteNumber)}`;

      if (dayOfWeek === "*") {
        return `todos los días a las ${time}`;
      }

      const range = /^([0-6])-([0-6])$/.exec(dayOfWeek);
      if (range !== null) {
        const start = DAY_NAMES[Number(range[1])];
        const end = DAY_NAMES[Number(range[2])];
        if (start !== undefined && end !== undefined) {
          return `de ${start} a ${end} a las ${time}`;
        }
      }

      const single = /^[0-6]$/.exec(dayOfWeek);
      if (single !== null) {
        const day = DAY_PLURALS[Number(single[0])];
        if (day !== undefined) {
          return `todos los ${day} a las ${time}`;
        }
      }
    }

    return `expresión cron ${expr}`.trim();
  } catch {
    return "expresión cron no válida";
  }
}
