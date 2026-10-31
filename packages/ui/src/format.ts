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

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: "En cola",
  running: "En curso",
  success: "Correcta",
  failed: "Fallida",
  timeout: "Agotada",
  skipped: "Omitida",
  interrupted: "Interrumpida",
};

export const RUN_TRIGGER_LABELS: Record<RunTrigger, string> = {
  scheduled: "Programada",
  catch_up: "Recuperada",
  manual: "Manual",
};

export const SCHEDULE_KIND_LABELS: Record<ScheduleKind, string> = {
  cron: "Cron",
  interval: "Intervalo",
  once: "Una vez",
};

export const CATCH_UP_LABELS: Record<CatchUpPolicy, string> = {
  none: "Ninguna",
  once: "Una vez",
  all: "Todas",
};

export const OVERLAP_LABELS: Record<OverlapPolicy, string> = {
  skip: "Omitir la nueva",
  queue: "Encolar la nueva",
  kill: "Terminar la anterior",
};

export const SESSION_MODE_LABELS: Record<SessionMode, string> = {
  independent: "Independiente",
  continuous: "Continua",
};

export const NOTIFY_ON_LABELS: Record<NotifyOn, string> = {
  always: "Siempre",
  failure: "Solo si falla",
  success: "Solo si va bien",
};

export const RUNNER_LABELS: Record<RunnerKind, string> = {
  opencode: "opencode (IA)",
  shell: "shell (comando)",
};

const dateTimeFormatter = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "short",
  timeStyle: "short",
});

const tokenFormatter = new Intl.NumberFormat("es-ES");

/** Formats a token count with Spanish thousands separators. */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return tokenFormatter.format(value);
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

/** Formats an epoch in milliseconds with the agreed Spanish short format. */
export function formatDateTime(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  return dateTimeFormatter.format(new Date(value));
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
        return `Cada ${job.scheduleExpr}`;
      }
      const amount = Number(match[1] ?? "0");
      const unit = match[2] === "h" ? "hora" : "minuto";
      return `Cada ${amount} ${amount === 1 ? unit : `${unit}s`}`;
    }
    case "once": {
      const date = new Date(job.scheduleExpr);
      if (Number.isNaN(date.getTime())) {
        return `Una vez: ${job.scheduleExpr}`;
      }
      return `Una vez: ${formatDateTime(date.getTime())}`;
    }
  }
}
