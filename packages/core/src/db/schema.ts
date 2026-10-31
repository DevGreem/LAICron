import type { DatabaseSync } from "node:sqlite";

/**
 * SQLite schema for LAICron.
 *
 * `trigger` is a reserved word in SQLite, so it is always quoted. All statements are idempotent
 * so that opening an existing database does not require a migration step yet.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  runner TEXT NOT NULL,
  prompt TEXT,
  command TEXT,
  args_json TEXT NOT NULL DEFAULT '[]',
  cwd TEXT NOT NULL,
  model TEXT,
  agent TEXT,
  session_mode TEXT NOT NULL DEFAULT 'independent',
  session_id TEXT,
  schedule_kind TEXT NOT NULL,
  schedule_expr TEXT NOT NULL,
  timezone TEXT NOT NULL,
  catch_up TEXT NOT NULL DEFAULT 'once',
  catch_up_limit INTEGER NOT NULL DEFAULT 10,
  overlap TEXT NOT NULL DEFAULT 'skip',
  timeout_sec INTEGER NOT NULL DEFAULT 600,
  notify INTEGER NOT NULL DEFAULT 1,
  notify_on TEXT NOT NULL DEFAULT 'always',
  next_run_at INTEGER,
  last_run_at INTEGER,
  last_status TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  "trigger" TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  duration_ms INTEGER,
  exit_code INTEGER,
  output TEXT,
  error TEXT,
  session_id TEXT,
  missed_count INTEGER NOT NULL DEFAULT 0,
  notification_delivered INTEGER
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs(enabled, next_run_at);
CREATE INDEX IF NOT EXISTS idx_runs_job_started ON runs(job_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_job_status ON runs(job_id, status);
CREATE INDEX IF NOT EXISTS idx_messages_job_created ON messages(job_id, created_at);
`;

/** Applies the schema to an open database. Safe to call on every startup. */
export function applySchema(db: DatabaseSync): void {
  db.exec(SCHEMA_SQL);
}
