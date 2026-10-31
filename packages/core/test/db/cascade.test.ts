import { afterEach, describe, expect, it } from "vitest";

import { createRepositories } from "../../src/db/index.js";
import { cleanupTempDatabases, openTempDatabase } from "./helpers.js";

afterEach(cleanupTempDatabases);

describe("job deletion", () => {
  it("cascades to runs and messages", () => {
    const { db } = openTempDatabase();
    const repos = createRepositories(db);
    const job = repos.jobs.create({
      name: "Borrar",
      runner: "shell",
      command: "true",
      scheduleKind: "cron",
      scheduleExpr: "0 9 * * *",
    });
    const run = repos.runs.create({ jobId: job.id, trigger: "scheduled", status: "queued" });
    repos.messages.create({
      jobId: job.id,
      runId: run.id,
      role: "user",
      content: "hola",
      createdAt: 100,
    });
    repos.messages.create({
      jobId: job.id,
      runId: run.id,
      role: "assistant",
      content: "mundo",
      createdAt: 200,
    });

    expect(repos.runs.countByJob(job.id)).toBe(1);
    expect(repos.messages.countByJob(job.id)).toBe(2);

    repos.jobs.remove(job.id);

    expect(repos.jobs.get(job.id)).toBeNull();
    expect(repos.runs.get(run.id)).toBeNull();
    expect(repos.runs.countByJob(job.id)).toBe(0);
    expect(repos.messages.countByJob(job.id)).toBe(0);
    expect(repos.messages.listByRun(run.id)).toEqual([]);
  });
});
