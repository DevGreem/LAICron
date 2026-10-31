import { afterEach, describe, expect, it } from "vitest";

import { createRepositories, type Job, type Repositories, type Run } from "../../src/db/index.js";
import { cleanupTempDatabases, openTempDatabase } from "./helpers.js";

afterEach(cleanupTempDatabases);

function setup(): { repos: Repositories; job: Job } {
  const { db } = openTempDatabase();
  const repos = createRepositories(db);
  const job = repos.jobs.create({
    name: "Trabajo",
    runner: "shell",
    command: "true",
    scheduleKind: "cron",
    scheduleExpr: "* * * * *",
  });
  return { repos, job };
}

describe("RunRepository", () => {
  it("creates a queued run, marks it started and finishes it", () => {
    const { repos, job } = setup();

    const run = repos.runs.create({ jobId: job.id, trigger: "scheduled", status: "queued" });

    expect(run).toMatchObject({
      jobId: job.id,
      trigger: "scheduled",
      status: "queued",
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      exitCode: null,
      output: null,
      error: null,
      sessionId: null,
      missedCount: 0,
      notificationDelivered: null,
    });

    const started = repos.runs.markStarted(run.id, 1_000);
    expect(started.status).toBe("running");
    expect(started.startedAt).toBe(1_000);

    const finished = repos.runs.finish(run.id, {
      status: "success",
      finishedAt: 2_000,
      durationMs: 1_000,
      exitCode: 0,
      output: "ok",
      error: null,
      sessionId: "ses_1",
      notificationDelivered: true,
    });

    expect(finished).toMatchObject({
      status: "success",
      startedAt: 1_000,
      finishedAt: 2_000,
      durationMs: 1_000,
      exitCode: 0,
      output: "ok",
      error: null,
      sessionId: "ses_1",
      notificationDelivered: true,
    });
    expect(repos.runs.get(run.id)).toEqual(finished);
  });

  it("stores an undelivered notification as null", () => {
    const { repos, job } = setup();
    const run = repos.runs.create({ jobId: job.id, trigger: "manual", status: "queued" });

    repos.runs.markStarted(run.id, 1_000);
    const finished = repos.runs.finish(run.id, {
      status: "failed",
      finishedAt: 1_500,
      durationMs: 500,
      exitCode: 1,
      output: "",
      error: "boom",
      sessionId: null,
      notificationDelivered: null,
    });

    expect(finished.notificationDelivered).toBeNull();
  });

  it("finds the active run with queued runs first", () => {
    const { repos, job } = setup();
    const queued = repos.runs.create({ jobId: job.id, trigger: "scheduled", status: "queued" });
    const running = repos.runs.create({ jobId: job.id, trigger: "manual", status: "queued" });
    repos.runs.markStarted(running.id, 500);

    expect(repos.runs.activeByJob(job.id)?.id).toBe(queued.id);

    repos.runs.finish(queued.id, {
      status: "skipped",
      finishedAt: 600,
      durationMs: 0,
      exitCode: null,
      output: null,
      error: null,
      sessionId: null,
      notificationDelivered: false,
    });
    expect(repos.runs.activeByJob(job.id)?.id).toBe(running.id);

    repos.runs.finish(running.id, {
      status: "success",
      finishedAt: 700,
      durationMs: 200,
      exitCode: 0,
      output: "",
      error: null,
      sessionId: null,
      notificationDelivered: true,
    });
    expect(repos.runs.activeByJob(job.id)).toBeNull();
  });

  it("paginates the history newest first and counts runs", () => {
    const { repos, job } = setup();
    const ids: string[] = [];

    for (let index = 0; index < 5; index += 1) {
      const run = repos.runs.create({ jobId: job.id, trigger: "scheduled", status: "queued" });
      repos.runs.markStarted(run.id, 1_000 + index);
      ids.push(run.id);
    }

    expect(repos.runs.countByJob(job.id)).toBe(5);
    expect(
      repos.runs.listByJob(job.id, { limit: 2, offset: 0 }).map((run) => run.startedAt),
    ).toEqual([1_004, 1_003]);
    expect(
      repos.runs.listByJob(job.id, { limit: 2, offset: 2 }).map((run) => run.startedAt),
    ).toEqual([1_002, 1_001]);
    expect(repos.runs.listByJob(job.id, { limit: 10, offset: 4 }).map((run) => run.id)).toEqual([
      ids[0],
    ]);
  });

  it("marks running and queued runs as interrupted without touching finished ones", () => {
    const { repos, job } = setup();

    const running = repos.runs.create({ jobId: job.id, trigger: "scheduled", status: "queued" });
    repos.runs.markStarted(running.id, 1_000);

    const queued = repos.runs.create({ jobId: job.id, trigger: "scheduled", status: "queued" });

    const success = repos.runs.create({ jobId: job.id, trigger: "manual", status: "queued" });
    repos.runs.markStarted(success.id, 1_000);
    repos.runs.finish(success.id, {
      status: "success",
      finishedAt: 2_000,
      durationMs: 1_000,
      exitCode: 0,
      output: "done",
      error: null,
      sessionId: null,
      notificationDelivered: true,
    });

    expect(repos.runs.markRunningAsInterrupted(5_000)).toBe(2);

    const interrupted = repos.runs.get(running.id);
    expect(interrupted).toMatchObject({
      status: "interrupted",
      finishedAt: 5_000,
      durationMs: 4_000,
      error: "daemon restarted",
    });

    const queuedInterrupted = repos.runs.get(queued.id);
    expect(queuedInterrupted).toMatchObject({
      status: "interrupted",
      startedAt: null,
      finishedAt: 5_000,
      durationMs: 0,
      error: "daemon restarted before start",
    });

    const untouched = repos.runs.get(success.id);
    expect(untouched).toMatchObject({ status: "success", finishedAt: 2_000, error: null });

    expect(repos.runs.markRunningAsInterrupted(6_000)).toBe(0);
  });

  it("prunes by count and cascades to messages", () => {
    const { repos, job } = setup();
    const now = Date.now();
    const runs: Run[] = [];

    for (let index = 0; index < 5; index += 1) {
      const run = repos.runs.create({ jobId: job.id, trigger: "scheduled", status: "queued" });
      repos.runs.markStarted(run.id, now - index * 1_000);
      repos.messages.create({
        jobId: job.id,
        runId: run.id,
        role: "user",
        content: `mensaje ${index}`,
        createdAt: now - index * 1_000,
      });
      runs.push(run);
    }

    const deleted = repos.runs.pruneForJob(job.id, {
      maxAgeMs: 365 * 24 * 60 * 60 * 1_000,
      maxCount: 3,
    });

    expect(deleted).toBe(2);
    expect(repos.runs.countByJob(job.id)).toBe(3);
    expect(repos.runs.listByJob(job.id, { limit: 10, offset: 0 }).map((run) => run.id)).toEqual([
      runs[0]?.id,
      runs[1]?.id,
      runs[2]?.id,
    ]);
    expect(repos.messages.countByJob(job.id)).toBe(3);
    expect(repos.messages.listByRun(runs[3]?.id ?? "")).toEqual([]);
    expect(repos.messages.listByRun(runs[4]?.id ?? "")).toEqual([]);
  });

  it("prunes runs older than the age limit", () => {
    const { repos, job } = setup();
    const now = Date.now();

    const old = repos.runs.create({ jobId: job.id, trigger: "scheduled", status: "queued" });
    repos.runs.markStarted(old.id, now - 100_000);

    const recent = repos.runs.create({ jobId: job.id, trigger: "scheduled", status: "queued" });
    repos.runs.markStarted(recent.id, now - 50_000);

    const fresh = repos.runs.create({ jobId: job.id, trigger: "scheduled", status: "queued" });
    repos.runs.markStarted(fresh.id, now);

    const deleted = repos.runs.pruneForJob(job.id, { maxAgeMs: 60_000, maxCount: 100 });

    expect(deleted).toBe(1);
    expect(repos.runs.get(old.id)).toBeNull();
    expect(repos.runs.listByJob(job.id, { limit: 10, offset: 0 }).map((run) => run.id)).toEqual([
      fresh.id,
      recent.id,
    ]);
  });
});
