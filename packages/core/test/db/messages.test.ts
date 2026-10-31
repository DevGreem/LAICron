import { afterEach, describe, expect, it } from "vitest";

import { createRepositories, type Job, type Repositories, type Run } from "../../src/db/index.js";
import { cleanupTempDatabases, openTempDatabase } from "./helpers.js";

afterEach(cleanupTempDatabases);

function setup(): { repos: Repositories; job: Job; run: Run } {
  const { db } = openTempDatabase();
  const repos = createRepositories(db);
  const job = repos.jobs.create({
    name: "Chat",
    runner: "opencode",
    prompt: "Hola",
    scheduleKind: "cron",
    scheduleExpr: "0 9 * * *",
  });
  const run = repos.runs.create({ jobId: job.id, trigger: "scheduled", status: "queued" });
  return { repos, job, run };
}

describe("MessageRepository", () => {
  it("creates user and assistant messages and lists them by run", () => {
    const { repos, job, run } = setup();

    const user = repos.messages.create({
      jobId: job.id,
      runId: run.id,
      role: "user",
      content: "Pregunta",
      createdAt: 100,
    });
    const assistant = repos.messages.create({
      jobId: job.id,
      runId: run.id,
      role: "assistant",
      content: "Respuesta",
      createdAt: 200,
    });

    expect(user).toMatchObject({ jobId: job.id, runId: run.id, role: "user", content: "Pregunta" });
    expect(repos.messages.listByRun(run.id).map((message) => message.id)).toEqual([
      user.id,
      assistant.id,
    ]);
    expect(repos.messages.countByJob(job.id)).toBe(2);
  });

  it("paginates messages by job in chronological order", () => {
    const { repos, job } = setup();
    const contents = ["tercero", "primero", "segundo"];
    const timestamps = [300, 100, 200];

    timestamps.forEach((createdAt, index) => {
      const run = repos.runs.create({ jobId: job.id, trigger: "manual", status: "queued" });
      repos.messages.create({
        jobId: job.id,
        runId: run.id,
        role: "user",
        content: contents[index] ?? "",
        createdAt,
      });
    });

    expect(
      repos.messages.listByJob(job.id, { limit: 2, offset: 0 }).map((message) => message.content),
    ).toEqual(["primero", "segundo"]);
    expect(
      repos.messages.listByJob(job.id, { limit: 2, offset: 2 }).map((message) => message.content),
    ).toEqual(["tercero"]);
  });
});
