import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { Job, RunStatus } from "../types.js";
import { NotFoundError } from "./errors.js";
import { toJob } from "./mappers.js";
import type { CreateJobInput, JobRepository, UpdateJobInput } from "./repository-types.js";
import { applyJobDefaults, validateJobFields } from "./validation.js";

const JOB_COLUMNS = `id, name, enabled, runner, prompt, command, args_json, cwd, model, agent,
  session_mode, session_id, schedule_kind, schedule_expr, timezone, catch_up, catch_up_limit,
  overlap, timeout_sec, notify, notify_on, mcp_overrides, next_run_at, last_run_at, last_status,
  created_at, updated_at`;

function currentAsCreateInput(job: Job): CreateJobInput {
  return {
    name: job.name,
    enabled: job.enabled,
    runner: job.runner,
    prompt: job.prompt,
    command: job.command,
    args: job.args,
    cwd: job.cwd,
    model: job.model,
    agent: job.agent,
    sessionMode: job.sessionMode,
    sessionId: job.sessionId,
    scheduleKind: job.scheduleKind,
    scheduleExpr: job.scheduleExpr,
    timezone: job.timezone,
    catchUp: job.catchUp,
    catchUpLimit: job.catchUpLimit,
    overlap: job.overlap,
    timeoutSec: job.timeoutSec,
    notify: job.notify,
    notifyOn: job.notifyOn,
    mcpOverrides: job.mcpOverrides,
  };
}

/** SQLite-backed implementation of the job repository. */
export function createJobRepository(db: DatabaseSync): JobRepository {
  function getJob(id: string): Job | null {
    const row = db.prepare(`SELECT ${JOB_COLUMNS} FROM jobs WHERE id = ?`).get(id);
    return row === undefined ? null : toJob(row);
  }

  return {
    create(input: CreateJobInput): Job {
      const fields = applyJobDefaults(input);
      validateJobFields(fields);

      const id = randomUUID();
      const now = Date.now();
      db.prepare(
        `INSERT INTO jobs (${JOB_COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        fields.name,
        fields.enabled ? 1 : 0,
        fields.runner,
        fields.prompt,
        fields.command,
        JSON.stringify(fields.args),
        fields.cwd,
        fields.model,
        fields.agent,
        fields.sessionMode,
        fields.sessionId,
        fields.scheduleKind,
        fields.scheduleExpr,
        fields.timezone,
        fields.catchUp,
        fields.catchUpLimit,
        fields.overlap,
        fields.timeoutSec,
        fields.notify ? 1 : 0,
        fields.notifyOn,
        JSON.stringify(fields.mcpOverrides),
        null,
        null,
        null,
        now,
        now,
      );

      const created = getJob(id);
      if (created === null) {
        throw new Error("No se pudo leer el cron recién creado.");
      }
      return created;
    },

    get: getJob,

    list(filter?: { enabled?: boolean }): Job[] {
      const rows =
        filter?.enabled === undefined
          ? db.prepare(`SELECT ${JOB_COLUMNS} FROM jobs ORDER BY created_at ASC, id ASC`).all()
          : db
              .prepare(
                `SELECT ${JOB_COLUMNS} FROM jobs WHERE enabled = ? ORDER BY created_at ASC, id ASC`,
              )
              .all(filter.enabled ? 1 : 0);
      return rows.map(toJob);
    },

    update(id: string, patch: UpdateJobInput): Job {
      const existing = getJob(id);
      if (existing === null) {
        throw new NotFoundError(`No se encontró el cron ${id}.`);
      }

      // Validate the merged result, not just the patch, so changing one field cannot leave the
      // job in an inconsistent state (for example switching runner without its required field).
      const merged = applyJobDefaults({ ...currentAsCreateInput(existing), ...patch });
      validateJobFields(merged);

      const updatedAt = Date.now();
      db.prepare(
        `UPDATE jobs SET
           name = ?, enabled = ?, runner = ?, prompt = ?, command = ?, args_json = ?, cwd = ?,
           model = ?, agent = ?, session_mode = ?, session_id = ?, schedule_kind = ?,
           schedule_expr = ?, timezone = ?, catch_up = ?, catch_up_limit = ?, overlap = ?,
           timeout_sec = ?, notify = ?, notify_on = ?, mcp_overrides = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        merged.name,
        merged.enabled ? 1 : 0,
        merged.runner,
        merged.prompt,
        merged.command,
        JSON.stringify(merged.args),
        merged.cwd,
        merged.model,
        merged.agent,
        merged.sessionMode,
        merged.sessionId,
        merged.scheduleKind,
        merged.scheduleExpr,
        merged.timezone,
        merged.catchUp,
        merged.catchUpLimit,
        merged.overlap,
        merged.timeoutSec,
        merged.notify ? 1 : 0,
        merged.notifyOn,
        JSON.stringify(merged.mcpOverrides),
        updatedAt,
        id,
      );

      const updated = getJob(id);
      if (updated === null) {
        throw new NotFoundError(`No se encontró el cron ${id}.`);
      }
      return updated;
    },

    remove(id: string): void {
      // Runs and messages are removed by ON DELETE CASCADE (foreign_keys is enabled on open).
      db.prepare("DELETE FROM jobs WHERE id = ?").run(id);
    },

    dueBefore(nowMs: number): Job[] {
      const rows = db
        .prepare(
          `SELECT ${JOB_COLUMNS} FROM jobs
           WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
           ORDER BY next_run_at ASC, id ASC`,
        )
        .all(nowMs);
      return rows.map(toJob);
    },

    setNextRun(id: string, nextRunAt: number | null): void {
      db.prepare("UPDATE jobs SET next_run_at = ? WHERE id = ?").run(nextRunAt, id);
    },

    recordOutcome(id: string, status: RunStatus, atMs: number): void {
      db.prepare(
        "UPDATE jobs SET last_run_at = ?, last_status = ?, updated_at = ? WHERE id = ?",
      ).run(atMs, status, atMs, id);
    },
  };
}
