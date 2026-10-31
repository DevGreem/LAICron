import type { DatabaseSync } from "node:sqlite";

import { asNullableString } from "./mappers.js";
import type { MetaRepository } from "./repository-types.js";

/** Simple key/value store for daemon metadata (heartbeat, schema version, ...). */
export function createMetaRepository(db: DatabaseSync): MetaRepository {
  return {
    get(key: string): string | null {
      const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
      return row === undefined ? null : asNullableString(row["value"]);
    },

    set(key: string, value: string): void {
      db.prepare(
        `INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run(key, value);
    },
  };
}
