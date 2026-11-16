import type { DatabaseSync } from "node:sqlite";

/**
 * SQLite schema for LAICron.
 *
 * `trigger` is a reserved word in SQLite, so it is always quoted. Table creation is idempotent and
 * columns added after the first release are handled by guarded migrations, so opening an existing
 * database on every startup is safe.
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
  mcp_overrides TEXT NOT NULL DEFAULT '{}',
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
  notification_delivered INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  reasoning_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  cost_usd REAL
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

function jobColumns(db: DatabaseSync): string[] {
  return db
    .prepare("PRAGMA table_info('jobs')")
    .all()
    .map((column) => String(column["name"]));
}

function runColumns(db: DatabaseSync): string[] {
  return db
    .prepare("PRAGMA table_info('runs')")
    .all()
    .map((column) => String(column["name"]));
}

/** Columns added to `runs` for per-execution consumption; they must stay nullable. */
const RUN_USAGE_COLUMNS: ReadonlyArray<{ name: string; type: "INTEGER" | "REAL" }> = [
  { name: "input_tokens", type: "INTEGER" },
  { name: "output_tokens", type: "INTEGER" },
  { name: "reasoning_tokens", type: "INTEGER" },
  { name: "cache_read_tokens", type: "INTEGER" },
  { name: "cache_write_tokens", type: "INTEGER" },
  { name: "cost_usd", type: "REAL" },
];

/**
 * Adds columns introduced after the first release to databases created by older versions.
 * Each migration is guarded by a column check, so it is safe to run on every startup.
 */
function migrateJobs(db: DatabaseSync): void {
  const columns = jobColumns(db);
  if (!columns.includes("mcp_overrides")) {
    db.exec("ALTER TABLE jobs ADD COLUMN mcp_overrides TEXT NOT NULL DEFAULT '{}'");
  }
}

/** Adds the consumption columns one by one, leaving existing runs without data as `NULL`. */
function migrateRuns(db: DatabaseSync): void {
  const columns = runColumns(db);
  for (const column of RUN_USAGE_COLUMNS) {
    if (!columns.includes(column.name)) {
      db.exec(`ALTER TABLE runs ADD COLUMN ${column.name} ${column.type}`);
    }
  }
}

/** Applies the schema to an open database. Safe to call on every startup. */
export function applySchema(db: DatabaseSync): void {
  db.exec(SCHEMA_SQL);
  migrateJobs(db);
  migrateRuns(db);
}
