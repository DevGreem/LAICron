import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  closeDatabase,
  createRepositories,
  openDatabase,
  ValidationError,
  type CreateJobInput,
  type JobRepository,
} from "../../src/db/index.js";
import type { McpState } from "../../src/types.js";
import { cleanupTempDatabases, openTempDatabase, tempDatabasePath } from "./helpers.js";

afterEach(cleanupTempDatabases);

function shellJob(overrides: Partial<CreateJobInput> = {}): CreateJobInput {
  return {
    name: "Cron con MCPs",
    runner: "shell",
    command: "echo hola",
    scheduleKind: "cron",
    scheduleExpr: "0 9 * * *",
    ...overrides,
  };
}

function setup(): JobRepository {
  const { db } = openTempDatabase();
  return createRepositories(db).jobs;
}

function expectValidationError(run: () => unknown, field: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).field).toBe(field);
    return;
  }
  throw new Error(`Se esperaba un ValidationError en el campo ${field}.`);
}

/** The `jobs` table as created by versions before `mcp_overrides` existed. */
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

const LEGACY_JOB_ID = "legacy-job";

function createLegacyDatabase(path: string): void {
  const legacy = new DatabaseSync(path);
  try {
    legacy.exec(LEGACY_JOBS_SQL);
    legacy
      .prepare(
        `INSERT INTO jobs (
           id, name, enabled, runner, prompt, command, args_json, cwd, model, agent,
           session_mode, session_id, schedule_kind, schedule_expr, timezone, catch_up,
           catch_up_limit, overlap, timeout_sec, notify, notify_on, next_run_at, last_run_at,
           last_status, created_at, updated_at
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         )`,
      )
      .run(
        LEGACY_JOB_ID,
        "Cron antiguo",
        1,
        "shell",
        null,
        "echo antiguo",
        "[]",
        "/tmp",
        null,
        null,
        "independent",
        null,
        "cron",
        "0 9 * * *",
        "UTC",
        "once",
        10,
        "skip",
        600,
        1,
        "always",
        null,
        null,
        null,
        1,
        1,
      );
  } finally {
    legacy.close();
  }
}

function jobColumns(db: DatabaseSync): string[] {
  return db
    .prepare("PRAGMA table_info('jobs')")
    .all()
    .map((column) => String(column["name"]));
}

describe("jobs.mcp_overrides", () => {
  it("migrates an existing database and keeps old jobs fully inherited", () => {
    const { path } = tempDatabasePath();
    createLegacyDatabase(path);

    const migrated = openDatabase(path);
    try {
      expect(jobColumns(migrated)).toContain("mcp_overrides");

      const job = createRepositories(migrated).jobs.get(LEGACY_JOB_ID);
      expect(job).not.toBeNull();
      expect(job?.name).toBe("Cron antiguo");
      expect(job?.mcpOverrides).toEqual({});
    } finally {
      closeDatabase(migrated);
    }

    // Running the migration again on the same database must be a no-op.
    const reopened = openDatabase(path);
    try {
      expect(jobColumns(reopened)).toContain("mcp_overrides");
      expect(createRepositories(reopened).jobs.get(LEGACY_JOB_ID)?.mcpOverrides).toEqual({});
    } finally {
      closeDatabase(reopened);
    }
  });

  it("defaults new jobs to an empty override set", () => {
    const jobs = setup();

    const job = jobs.create(shellJob());

    expect(job.mcpOverrides).toEqual({});
    expect(jobs.get(job.id)?.mcpOverrides).toEqual({});
  });

  it("persists overrides on create and update", () => {
    const jobs = setup();

    const created = jobs.create(shellJob({ mcpOverrides: { github: "on", xerj: "off" } }));

    expect(created.mcpOverrides).toEqual({ github: "on", xerj: "off" });
    expect(jobs.get(created.id)?.mcpOverrides).toEqual({ github: "on", xerj: "off" });

    const updated = jobs.update(created.id, { mcpOverrides: { xerj: "off" } });

    expect(updated.mcpOverrides).toEqual({ xerj: "off" });
    expect(jobs.get(created.id)?.mcpOverrides).toEqual({ xerj: "off" });
  });

  it("normalizes inherit and empty names away", () => {
    const jobs = setup();

    const job = jobs.create(
      shellJob({
        mcpOverrides: {
          github: "inherit",
          "": "on",
          "   ": "off",
        } as unknown as Record<string, McpState>,
      }),
    );

    expect(job.mcpOverrides).toEqual({});
    expect(jobs.get(job.id)?.mcpOverrides).toEqual({});
  });

  it("keeps valid entries while dropping inherited ones", () => {
    const jobs = setup();

    const job = jobs.create(
      shellJob({
        mcpOverrides: {
          github: "inherit",
          xerj: "off",
        } as unknown as Record<string, McpState>,
      }),
    );

    expect(job.mcpOverrides).toEqual({ xerj: "off" });
  });

  it("rejects unknown states with a validation error on the mcpOverrides field", () => {
    const jobs = setup();

    expectValidationError(
      () =>
        jobs.create(
          shellJob({
            mcpOverrides: { github: "maybe" } as unknown as Record<string, McpState>,
          }),
        ),
      "mcpOverrides",
    );
    expect(jobs.list()).toEqual([]);
  });

  it("rejects more than 100 overrides", () => {
    const jobs = setup();
    const tooMany: Record<string, McpState> = {};
    for (let index = 0; index <= 100; index += 1) {
      tooMany[`mcp-${index}`] = "on";
    }

    expectValidationError(() => jobs.create(shellJob({ mcpOverrides: tooMany })), "mcpOverrides");
    expect(jobs.list()).toEqual([]);
  });

  it("falls back to inherited when the stored JSON is corrupt", () => {
    const { db } = openTempDatabase();
    const jobs = createRepositories(db).jobs;
    const job = jobs.create(shellJob());

    db.prepare("UPDATE jobs SET mcp_overrides = ? WHERE id = ?").run("not-json", job.id);
    expect(jobs.get(job.id)?.mcpOverrides).toEqual({});

    db.prepare("UPDATE jobs SET mcp_overrides = ? WHERE id = ?").run(
      JSON.stringify({ github: "maybe" }),
      job.id,
    );
    expect(jobs.get(job.id)?.mcpOverrides).toEqual({});
  });
});
