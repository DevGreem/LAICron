import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  closeDatabase,
  createRepositories,
  openDatabase,
  type Database,
  type Repositories,
} from "../../src/db/index.js";
import type { Job, RunUsage } from "../../src/types.js";
import { cleanupTempDatabases, openTempDatabase, tempDatabasePath } from "./helpers.js";

afterEach(cleanupTempDatabases);

/** The `jobs` and `runs` tables as created by versions before consumption was recorded. */
const LEGACY_JOBS_SQL = `
CREATE TABLE jobs (
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
`;

const LEGACY_RUNS_SQL = `
CREATE TABLE runs (
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
`;

const USAGE_COLUMNS = [
  "input_tokens",
  "output_tokens",
  "reasoning_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "cost_usd",
];

const LEGACY_RUN_ID = "legacy-run";
const LEGACY_JOB_ID = "legacy-job";

function runColumns(db: DatabaseSync): string[] {
  return db
    .prepare("PRAGMA table_info('runs')")
    .all()
    .map((column) => String(column["name"]));
}

function createLegacyDatabase(path: string): void {
  const legacy = new DatabaseSync(path);
  try {
    legacy.exec(LEGACY_JOBS_SQL);
    legacy.exec(LEGACY_RUNS_SQL);
    legacy
      .prepare(
        `INSERT INTO jobs (id, name, runner, cwd, schedule_kind, schedule_expr, timezone,
                           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(LEGACY_JOB_ID, "Cron antiguo", "shell", "/tmp", "cron", "0 9 * * *", "UTC", 1, 1);
    legacy
      .prepare(
        `INSERT INTO runs (id, job_id, "trigger", status, output)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(LEGACY_RUN_ID, LEGACY_JOB_ID, "scheduled", "success", "antiguo");
  } finally {
    legacy.close();
  }
}

interface Setup {
  db: Database;
  repos: Repositories;
  job: Job;
}

function setup(): Setup {
  const { db } = openTempDatabase();
  const repos = createRepositories(db);
  const job = repos.jobs.create({
    name: "Trabajo",
    runner: "shell",
    command: "true",
    scheduleKind: "cron",
    scheduleExpr: "* * * * *",
  });
  return { db, repos, job };
}

function finishRun(repos: Repositories, runId: string, usage?: RunUsage | null): void {
  repos.runs.finish(runId, {
    status: "success",
    finishedAt: 2_000,
    durationMs: 1_000,
    exitCode: 0,
    output: "ok",
    error: null,
    sessionId: null,
    notificationDelivered: null,
    usage,
  });
}

describe("run consumption", () => {
  it("migrates a legacy runs table and leaves old runs without usage", () => {
    const { path } = tempDatabasePath();
    createLegacyDatabase(path);

    const migrated = openDatabase(path);
    try {
      expect(runColumns(migrated)).toEqual(expect.arrayContaining(USAGE_COLUMNS));

      const run = createRepositories(migrated).runs.get(LEGACY_RUN_ID);
      expect(run).not.toBeNull();
      expect(run).toMatchObject({
        id: LEGACY_RUN_ID,
        output: "antiguo",
        inputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        costUsd: null,
      });
    } finally {
      closeDatabase(migrated);
    }

    // Running the migration again on the same database must be a no-op.
    const reopened = openDatabase(path);
    try {
      expect(runColumns(reopened)).toEqual(expect.arrayContaining(USAGE_COLUMNS));
      const run = createRepositories(reopened).runs.get(LEGACY_RUN_ID);
      expect(run?.inputTokens).toBeNull();
      expect(run?.costUsd).toBeNull();
    } finally {
      closeDatabase(reopened);
    }
  });

  it("stores tokens and cost when finishing with usage", () => {
    const { repos, job } = setup();
    const run = repos.runs.create({ jobId: job.id, trigger: "scheduled", status: "queued" });
    repos.runs.markStarted(run.id, 1_000);

    const usage: RunUsage = {
      inputTokens: 1_200,
      outputTokens: 340,
      reasoningTokens: 56,
      cacheReadTokens: 700,
      cacheWriteTokens: 80,
      costUsd: 0.0456,
    };

    const finished = repos.runs.finish(run.id, {
      status: "success",
      finishedAt: 2_000,
      durationMs: 1_000,
      exitCode: 0,
      output: "ok",
      error: null,
      sessionId: "ses_1",
      notificationDelivered: true,
      usage,
    });

    expect(finished).toMatchObject(usage);
    expect(repos.runs.get(run.id)).toEqual(finished);
  });

  it("leaves every consumption column as null when finishing without usage", () => {
    const { repos, job } = setup();

    const withoutUsage = repos.runs.create({
      jobId: job.id,
      trigger: "scheduled",
      status: "queued",
    });
    repos.runs.markStarted(withoutUsage.id, 1_000);
    finishRun(repos, withoutUsage.id);

    const explicitNull = repos.runs.create({
      jobId: job.id,
      trigger: "manual",
      status: "queued",
    });
    repos.runs.markStarted(explicitNull.id, 1_000);
    finishRun(repos, explicitNull.id, null);

    for (const runId of [withoutUsage.id, explicitNull.id]) {
      const run = repos.runs.get(runId);
      expect(run).toMatchObject({
        inputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        costUsd: null,
      });
    }
  });

  it("aggregates usage per job, ignoring runs without data", () => {
    const { db, repos, job } = setup();

    const withUsage = repos.runs.create({
      jobId: job.id,
      trigger: "scheduled",
      status: "queued",
    });
    repos.runs.markStarted(withUsage.id, 1_000);
    finishRun(repos, withUsage.id, {
      inputTokens: 1_000,
      outputTokens: 200,
      reasoningTokens: 50,
      cacheReadTokens: 100,
      cacheWriteTokens: 20,
      costUsd: 0.5,
    });

    // Simulates a source that reported tokens but no cost or reasoning data.
    const tokensOnly = repos.runs.create({
      jobId: job.id,
      trigger: "manual",
      status: "queued",
    });
    repos.runs.markStarted(tokensOnly.id, 1_000);
    finishRun(repos, tokensOnly.id);
    db.prepare("UPDATE runs SET input_tokens = ?, output_tokens = ? WHERE id = ?").run(
      300,
      40,
      tokensOnly.id,
    );

    const withoutData = repos.runs.create({
      jobId: job.id,
      trigger: "catch_up",
      status: "queued",
    });
    repos.runs.markStarted(withoutData.id, 1_000);
    finishRun(repos, withoutData.id);

    expect(repos.runs.usageByJob(job.id)).toEqual({
      runs: 3,
      runsWithUsage: 2,
      inputTokens: 1_300,
      outputTokens: 240,
      reasoningTokens: 50,
      cacheReadTokens: 100,
      cacheWriteTokens: 20,
      costUsd: 0.5,
    });

    const emptyJob = repos.jobs.create({
      name: "Sin ejecuciones",
      runner: "shell",
      command: "true",
      scheduleKind: "cron",
      scheduleExpr: "0 9 * * *",
    });

    expect(repos.runs.usageByJob(emptyJob.id)).toEqual({
      runs: 0,
      runsWithUsage: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    });
  });
});
