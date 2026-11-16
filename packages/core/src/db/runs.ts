import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { JobUsage, Run, RunStatus, RunTrigger, RunUsage } from "../types.js";
import { NotFoundError } from "./errors.js";
import { asNumber, toRun } from "./mappers.js";
import { t } from "../i18n.js";
import type { RunRepository } from "./repository-types.js";

const RUN_COLUMNS = `id, job_id, "trigger", status, started_at, finished_at, duration_ms, exit_code,
  output, error, session_id, missed_count, notification_delivered,
  input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens, cost_usd`;

function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** SQLite-backed implementation of the run repository. */
export function createRunRepository(db: DatabaseSync): RunRepository {
  function getRun(id: string): Run | null {
    const row = db.prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE id = ?`).get(id);
    return row === undefined ? null : toRun(row);
  }

  function requireRun(id: string): Run {
    const run = getRun(id);
    if (run === null) {
      throw new NotFoundError(t("db.runNotFound", { id }));
    }
    return run;
  }

  return {
    create(input: {
      jobId: string;
      trigger: RunTrigger;
      status: RunStatus;
      missedCount?: number;
    }): Run {
      const id = randomUUID();
      db.prepare(
        `INSERT INTO runs (${RUN_COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.jobId,
        input.trigger,
        input.status,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        input.missedCount ?? 0,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      );
      return requireRun(id);
    },

    get: getRun,

    markStarted(id: string, atMs: number): Run {
      const result = db
        .prepare("UPDATE runs SET status = 'running', started_at = ? WHERE id = ?")
        .run(atMs, id);
      if (Number(result.changes) === 0) {
        throw new NotFoundError(t("db.runNotFound", { id }));
      }
      return requireRun(id);
    },

    finish(
      id: string,
      result: {
        status: RunStatus;
        finishedAt: number;
        durationMs: number;
        exitCode: number | null;
        output: string | null;
        error: string | null;
        sessionId: string | null;
        notificationDelivered: boolean | null;
        /** Omitted or `null` leaves every consumption column as `NULL`. */
        usage?: RunUsage | null;
      },
    ): Run {
      const notificationDelivered =
        result.notificationDelivered === null ? null : result.notificationDelivered ? 1 : 0;
      const usage = result.usage ?? null;
      const update = db
        .prepare(
          `UPDATE runs SET status = ?, finished_at = ?, duration_ms = ?, exit_code = ?, output = ?,
             error = ?, session_id = ?, notification_delivered = ?,
             input_tokens = ?, output_tokens = ?, reasoning_tokens = ?,
             cache_read_tokens = ?, cache_write_tokens = ?, cost_usd = ?
           WHERE id = ?`,
        )
        .run(
          result.status,
          result.finishedAt,
          result.durationMs,
          result.exitCode,
          result.output,
          result.error,
          result.sessionId,
          notificationDelivered,
          usage?.inputTokens ?? null,
          usage?.outputTokens ?? null,
          usage?.reasoningTokens ?? null,
          usage?.cacheReadTokens ?? null,
          usage?.cacheWriteTokens ?? null,
          usage?.costUsd ?? null,
          id,
        );
      if (Number(update.changes) === 0) {
        throw new NotFoundError(t("db.runNotFound", { id }));
      }
      return requireRun(id);
    },

    listByJob(jobId: string, opts: { limit: number; offset: number }): Run[] {
      const rows = db
        .prepare(
          `SELECT ${RUN_COLUMNS} FROM runs
           WHERE job_id = ?
           ORDER BY COALESCE(started_at, 0) DESC, id DESC
           LIMIT ? OFFSET ?`,
        )
        .all(jobId, opts.limit, opts.offset);
      return rows.map(toRun);
    },

    countByJob(jobId: string): number {
      const row = db.prepare("SELECT COUNT(*) AS total FROM runs WHERE job_id = ?").get(jobId);
      return asNumber(row?.["total"]);
    },

    activeByJob(jobId: string): Run | null {
      const row = db
        .prepare(
          `SELECT ${RUN_COLUMNS} FROM runs
           WHERE job_id = ? AND status IN ('queued', 'running')
           ORDER BY started_at ASC NULLS FIRST, id ASC
           LIMIT 1`,
        )
        .get(jobId);
      return row === undefined ? null : toRun(row);
    },

    usageByJob(jobId: string): JobUsage {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS runs,
                  SUM(CASE WHEN input_tokens IS NOT NULL OR output_tokens IS NOT NULL
                             OR reasoning_tokens IS NOT NULL OR cache_read_tokens IS NOT NULL
                             OR cache_write_tokens IS NOT NULL OR cost_usd IS NOT NULL
                           THEN 1 ELSE 0 END) AS runs_with_usage,
                  COALESCE(SUM(input_tokens), 0) AS input_tokens,
                  COALESCE(SUM(output_tokens), 0) AS output_tokens,
                  COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens,
                  COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
                  COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
                  COALESCE(SUM(cost_usd), 0) AS cost_usd
           FROM runs WHERE job_id = ?`,
        )
        .get(jobId);
      return {
        runs: asNumber(row?.["runs"]),
        runsWithUsage: asNumber(row?.["runs_with_usage"]),
        inputTokens: asNumber(row?.["input_tokens"]),
        outputTokens: asNumber(row?.["output_tokens"]),
        reasoningTokens: asNumber(row?.["reasoning_tokens"]),
        cacheReadTokens: asNumber(row?.["cache_read_tokens"]),
        cacheWriteTokens: asNumber(row?.["cache_write_tokens"]),
        costUsd: asNumber(row?.["cost_usd"]),
      };
    },

    markRunningAsInterrupted(nowMs: number): number {
      return inTransaction(db, () => {
        // Runs that had already started keep their elapsed time and existing error if any.
        const running = db
          .prepare(
            `UPDATE runs SET
               status = 'interrupted',
               finished_at = ?,
               duration_ms = CASE WHEN started_at IS NULL THEN duration_ms ELSE ? - started_at END,
               error = COALESCE(error, 'daemon restarted')
             WHERE status = 'running'`,
          )
          .run(nowMs, nowMs);

        // Queued runs never started; without this they would block overlap checks forever.
        const queued = db
          .prepare(
            `UPDATE runs SET
               status = 'interrupted',
               finished_at = ?,
               duration_ms = CASE WHEN started_at IS NULL THEN 0 ELSE ? - started_at END,
               error = 'daemon restarted before start'
             WHERE status = 'queued'`,
          )
          .run(nowMs, nowMs);

        return Number(running.changes) + Number(queued.changes);
      });
    },

    pruneForJob(jobId: string, opts: { maxAgeMs: number; maxCount: number }): number {
      return inTransaction(db, () => {
        const cutoff = Date.now() - opts.maxAgeMs;

        const byAge = db
          .prepare(
            `DELETE FROM runs
             WHERE job_id = ? AND started_at IS NOT NULL AND started_at < ?`,
          )
          .run(jobId, cutoff);

        // Keep the newest `maxCount` runs by start time; runs that never started count as oldest.
        const byCount = db
          .prepare(
            `DELETE FROM runs
             WHERE job_id = ?
               AND id NOT IN (
                 SELECT id FROM runs
                 WHERE job_id = ?
                 ORDER BY COALESCE(started_at, 0) DESC, id DESC
                 LIMIT ?
               )`,
          )
          .run(jobId, jobId, opts.maxCount);

        return Number(byAge.changes) + Number(byCount.changes);
      });
    },
  };
}
