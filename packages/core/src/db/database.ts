import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { applySchema } from "./schema.js";

/** The synchronous SQLite handle used across the persistence layer. */
export type Database = DatabaseSync;

/**
 * Opens (or creates) the SQLite database at `path`, enables WAL and foreign keys, and applies
 * the schema. The parent directory is created when missing; `:memory:` keeps SQLite's default
 * journal mode because WAL is not available for in-memory databases.
 */
export function openDatabase(path: string): Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  applySchema(db);
  return db;
}

/** Closes the handle if it is still open. Safe to call twice. */
export function closeDatabase(db: Database): void {
  if (db.isOpen) {
    db.close();
  }
}
