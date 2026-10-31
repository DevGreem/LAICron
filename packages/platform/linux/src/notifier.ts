import { spawn, type ChildProcess } from "node:child_process";

import type { NotificationPayload, Notifier, RunStatus } from "@laicron/core";
import { summarize } from "@laicron/core/notifications";

/** Binary used unless another one is given (GNOME and most desktops ship it). */
const DEFAULT_BIN = "notify-send";
const APP_NAME = "LAICron";

/** A notification that does not answer within this time counts as undelivered. */
const SPAWN_TIMEOUT_MS = 5_000;

const STATUS_LABELS: Readonly<Record<RunStatus, string>> = {
  queued: "queued",
  running: "running",
  success: "Correcta",
  failed: "Fallida",
  timeout: "Agotada",
  interrupted: "Interrumpida",
  skipped: "Omitida",
};

/**
 * Formats a duration as human-readable Spanish text:
 * `850 ms`, `12,3 s`, `2 min 5 s`.
 */
function formatDuration(durationMs: number): string {
  const rounded = Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : 0;

  if (rounded < 1000) {
    return `${rounded} ms`;
  }
  if (rounded < 59_950) {
    return `${(rounded / 1000).toFixed(1).replace(".", ",")} s`;
  }

  const totalSeconds = Math.round(rounded / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes} min ${seconds} s`;
}

function urgencyFor(status: RunStatus): "normal" | "critical" {
  return status === "failed" || status === "timeout" ? "critical" : "normal";
}

function titleFor(payload: NotificationPayload): string {
  return `${payload.jobName} · ${STATUS_LABELS[payload.status]}`;
}

function bodyFor(payload: NotificationPayload): string {
  const duration = formatDuration(payload.durationMs);
  const source = payload.error === null ? payload.summary : payload.error;
  const detail = summarize(source);

  return detail === "" ? duration : `${duration} · ${detail}`;
}

/**
 * Creates a {@link Notifier} backed by `notify-send`.
 *
 * Delivery is best effort: a missing binary, a non-zero exit or a hung process
 * resolve to `false` instead of throwing, so a failed notification never
 * changes the outcome of a run.
 */
export function createNotifier(options: { bin?: string } = {}): Notifier {
  const bin = options.bin ?? DEFAULT_BIN;

  return {
    notify(payload: NotificationPayload): Promise<boolean> {
      return new Promise<boolean>((resolve) => {
        let child: ChildProcess;

        const args = [
          "-a",
          APP_NAME,
          "-u",
          urgencyFor(payload.status),
          titleFor(payload),
          bodyFor(payload),
        ];

        try {
          child = spawn(bin, args, { stdio: "ignore" });
        } catch {
          resolve(false);
          return;
        }

        let settled = false;

        const finish = (delivered: boolean): void => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve(delivered);
        };

        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          finish(false);
        }, SPAWN_TIMEOUT_MS);

        child.once("error", () => finish(false));
        child.once("close", (code) => finish(code === 0));
      });
    },
  };
}
