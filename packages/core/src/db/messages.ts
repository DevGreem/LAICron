import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { Message } from "../types.js";
import { asNumber, toMessage } from "./mappers.js";
import { t } from "../i18n.js";
import type { MessageRepository } from "./repository-types.js";

const MESSAGE_COLUMNS = "id, job_id, run_id, role, content, created_at";

/** SQLite-backed implementation of the chat message repository. */
export function createMessageRepository(db: DatabaseSync): MessageRepository {
  function getMessage(id: string): Message | null {
    const row = db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = ?`).get(id);
    return row === undefined ? null : toMessage(row);
  }

  return {
    create(input: {
      jobId: string;
      runId: string;
      role: "user" | "assistant";
      content: string;
      createdAt: number;
    }): Message {
      const id = randomUUID();
      db.prepare(`INSERT INTO messages (${MESSAGE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`).run(
        id,
        input.jobId,
        input.runId,
        input.role,
        input.content,
        input.createdAt,
      );

      const created = getMessage(id);
      if (created === null) {
        throw new Error(t("db.messageCreateFailed"));
      }
      return created;
    },

    listByJob(jobId: string, opts: { limit: number; offset: number }): Message[] {
      const rows = db
        .prepare(
          `SELECT ${MESSAGE_COLUMNS} FROM messages
           WHERE job_id = ?
           ORDER BY created_at ASC, id ASC
           LIMIT ? OFFSET ?`,
        )
        .all(jobId, opts.limit, opts.offset);
      return rows.map(toMessage);
    },

    listByRun(runId: string): Message[] {
      const rows = db
        .prepare(
          `SELECT ${MESSAGE_COLUMNS} FROM messages
           WHERE run_id = ?
           ORDER BY created_at ASC, id ASC`,
        )
        .all(runId);
      return rows.map(toMessage);
    },

    countByJob(jobId: string): number {
      const row = db.prepare("SELECT COUNT(*) AS total FROM messages WHERE job_id = ?").get(jobId);
      return asNumber(row?.["total"]);
    },
  };
}
