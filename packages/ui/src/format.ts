import { dateTimeFormatter, numberFormatter, t } from "./i18n.js";
import type { MessageKey } from "./i18n.js";
import type {
  CatchUpPolicy,
  Job,
  NotifyOn,
  OverlapPolicy,
  RunnerKind,
  RunStatus,
  RunTrigger,
  ScheduleKind,
  SessionMode,
} from "./types.js";

/**
 * Builds a record whose values are translated on every read, so the labels
 * follow the current locale without rebuilding the module.
 */
function translatedRecord<K extends string>(keys: Record<K, MessageKey>): Record<K, string> {
  const record = {} as Record<K, string>;
  for (const key of Object.keys(keys) as K[]) {
    const messageKey = keys[key];
    Object.defineProperty(record, key, {
      enumerable: true,
      configurable: false,
      get: () => t(messageKey),
    });
  }
  return record;
}

export const RUN_STATUS_LABELS: Record<RunStatus, string> = translatedRecord({
  queued: "format.status.queued",
  running: "format.status.running",
  success: "format.status.success",
  failed: "format.status.failed",
  timeout: "format.status.timeout",
  skipped: "format.status.skipped",
  interrupted: "format.status.interrupted",
});

export const RUN_TRIGGER_LABELS: Record<RunTrigger, string> = translatedRecord({
  scheduled: "format.trigger.scheduled",
  catch_up: "format.trigger.catch_up",
  manual: "format.trigger.manual",
});

export const SCHEDULE_KIND_LABELS: Record<ScheduleKind, string> = translatedRecord({
  cron: "format.kind.cron",
  interval: "format.kind.interval",
  once: "format.kind.once",
});

export const CATCH_UP_LABELS: Record<CatchUpPolicy, string> = translatedRecord({
  none: "format.catchup.none",
  once: "format.catchup.once",
  all: "format.catchup.all",
});

export const OVERLAP_LABELS: Record<OverlapPolicy, string> = translatedRecord({
  skip: "format.overlap.skip",
  queue: "format.overlap.queue",
  kill: "format.overlap.kill",
});

export const SESSION_MODE_LABELS: Record<SessionMode, string> = translatedRecord({
  independent: "format.session.independent",
  continuous: "format.session.continuous",
});

export const NOTIFY_ON_LABELS: Record<NotifyOn, string> = translatedRecord({
  always: "format.notify.always",
  failure: "format.notify.failure",
  success: "format.notify.success",
});

export const RUNNER_LABELS: Record<RunnerKind, string> = translatedRecord({
  opencode: "format.runner.opencode",
  shell: "format.runner.shell",
});

/** Formats a token count with the locale's thousands separator. */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return numberFormatter().format(value);
}

/**
 * Formats a USD cost. Zero uses two decimals, normal amounts four and
 * sub-cent amounts six so tiny per-run costs stay visible.
 */
export function formatCost(value: number): string {
  if (!Number.isFinite(value) || value === 0) {
    return "$0.00";
  }
  const magnitude = Math.abs(value);
  return `$${value.toFixed(magnitude >= 0.01 ? 4 : 6)}`;
}

/** Formats an epoch in milliseconds with the locale's short date and time. */
export function formatDateTime(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  return dateTimeFormatter().format(new Date(value));
}

/** Human readable duration (ms → s/min/h). */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) {
    return "—";
  }
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }

  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds} s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
  }

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Short description of a job schedule, used in lists and detail views. */
export function scheduleSummary(
  job: Pick<Job, "scheduleKind" | "scheduleExpr" | "timezone">,
): string {
  switch (job.scheduleKind) {
    case "cron":
      return `Cron ${job.scheduleExpr}`;
    case "interval": {
      const match = /^(\d+)([mh])$/.exec(job.scheduleExpr.trim());
      if (match === null) {
        return t("format.everyRaw", { expr: job.scheduleExpr });
      }
      const amount = Number(match[1] ?? "0");
      const unit = match[2] === "h" ? "format.unit.hourOne" : "format.unit.minuteOne";
      const unitMany = match[2] === "h" ? "format.unit.hourMany" : "format.unit.minuteMany";
      return t("format.everyAmount", {
        amount,
        unit: amount === 1 ? t(unit) : t(unitMany),
      });
    }
    case "once": {
      const date = new Date(job.scheduleExpr);
      if (Number.isNaN(date.getTime())) {
        return t("format.onceAt", { date: job.scheduleExpr });
      }
      return t("format.onceAt", { date: formatDateTime(date.getTime()) });
    }
  }
}
