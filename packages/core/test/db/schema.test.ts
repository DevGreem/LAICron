import { existsSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { closeDatabase, openDatabase } from "../../src/db/index.js";
import { cleanupTempDatabases, openTempDatabase } from "./helpers.js";

afterEach(cleanupTempDatabases);

function tableNames(db: ReturnType<typeof openTempDatabase>["db"]): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => String(row["name"]));
}

function indexNames(db: ReturnType<typeof openTempDatabase>["db"], table: string): string[] {
  return db
    .prepare(`PRAGMA index_list('${table}')`)
    .all()
    .map((row) => String(row["name"]));
}

describe("database schema", () => {
  it("creates the directory, the four tables and the indexes", () => {
    const { db, path } = openTempDatabase({ nested: true });

    expect(existsSync(path)).toBe(true);
    expect(tableNames(db)).toEqual(expect.arrayContaining(["jobs", "runs", "messages", "meta"]));

    expect(indexNames(db, "jobs")).toContain("idx_jobs_due");
    expect(indexNames(db, "runs")).toEqual(
      expect.arrayContaining(["idx_runs_job_started", "idx_runs_job_status"]),
    );
    expect(indexNames(db, "messages")).toContain("idx_messages_job_created");
  });

  it("enables WAL, foreign keys and the busy timeout", () => {
    const { db } = openTempDatabase();

    const journalMode = db.prepare("PRAGMA journal_mode").get();
    expect(String(journalMode?.["journal_mode"]).toLowerCase()).toBe("wal");

    const foreignKeys = db.prepare("PRAGMA foreign_keys").get();
    expect(Number(foreignKeys?.["foreign_keys"])).toBe(1);

    const busyTimeout = db.prepare("PRAGMA busy_timeout").get();
    expect(Number(busyTimeout?.["timeout"])).toBe(5000);
  });

  it("uses a quoted trigger column and applies the schema idempotently", () => {
    const { db, path } = openTempDatabase();

    const runColumns = db
      .prepare("PRAGMA table_info('runs')")
      .all()
      .map((row) => String(row["name"]));
    expect(runColumns).toContain("trigger");

    // Reopening an existing database must not fail on CREATE ... IF NOT EXISTS.
    const reopened = openDatabase(path);
    try {
      expect(tableNames(reopened)).toEqual(
        expect.arrayContaining(["jobs", "runs", "messages", "meta"]),
      );
    } finally {
      closeDatabase(reopened);
    }
    expect(tableNames(db)).toContain("jobs");
  });
});
