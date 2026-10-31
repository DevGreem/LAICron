import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDatabase, openDatabase, type Database } from "../../src/db/index.js";

export interface TempDatabase {
  db: Database;
  dir: string;
  path: string;
}

const databases: Database[] = [];
const directories: string[] = [];

/** Creates a throwaway database under os.tmpdir() and registers it for cleanup. */
export function openTempDatabase(options: { nested?: boolean } = {}): TempDatabase {
  const dir = mkdtempSync(join(tmpdir(), "laicron-db-"));
  directories.push(dir);

  const path =
    options.nested === true ? join(dir, "missing", "laicron.db") : join(dir, "laicron.db");
  const db = openDatabase(path);
  databases.push(db);

  return { db, dir, path };
}

/** Closes every handle first, then removes the temporary directories (including WAL files). */
export function cleanupTempDatabases(): void {
  for (const db of databases.splice(0)) {
    closeDatabase(db);
  }
  for (const dir of directories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}
