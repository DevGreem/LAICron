import { afterEach, describe, expect, it, vi } from "vitest";

import { recoverMissedRuns } from "../../src/clock/index.js";
import { cleanupTempDatabases } from "../db/helpers.js";
import { createShellJob, setup } from "./helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
  cleanupTempDatabases();
});

describe("recoverMissedRuns", () => {
  it("records a skipped run and advances the schedule with the none policy", async () => {
    const nowMs = Date.parse("2026-07-05T09:00:00.000Z");
    const firstMissed = Date.parse("2026-07-01T09:00:00.000Z");
    const { repos, engine } = setup();
    const job = createShellJob(repos, {
      scheduleKind: "cron",
      scheduleExpr: "0 9 * * *",
      catchUp: "none",
    });
    repos.jobs.setNextRun(job.id, firstMissed);

    const report = await recoverMissedRuns({
      engine,
      jobs: repos.jobs,
      runs: repos.runs,
      meta: repos.meta,
      now: () => nowMs,
    });

    expect(engine.calls).toHaveLength(0);
    const runs = repos.runs.listByJob(job.id, { limit: 10, offset: 0 });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      trigger: "catch_up",
      status: "skipped",
      missedCount: 5,
      finishedAt: nowMs,
      durationMs: 0,
    });
    expect(report).toEqual({
      interrupted: 0,
      skipped: 1,
      executed: 0,
      jobs: [{ jobId: job.id, policy: "none", missed: 5, executed: 0 }],
    });
    expect(repos.jobs.get(job.id)?.nextRunAt).toBe(Date.parse("2026-07-06T09:00:00.000Z"));
  });

  it("runs once and reports every missed occurrence with the once policy", async () => {
    const nowMs = Date.parse("2026-07-05T09:00:00.000Z");
    const firstMissed = Date.parse("2026-07-01T09:00:00.000Z");
    const { repos, engine } = setup();
    const job = createShellJob(repos, {
      scheduleKind: "cron",
      scheduleExpr: "0 9 * * *",
      catchUp: "once",
    });
    repos.jobs.setNextRun(job.id, firstMissed);

    const report = await recoverMissedRuns({
      engine,
      jobs: repos.jobs,
      runs: repos.runs,
      meta: repos.meta,
      now: () => nowMs,
    });

    expect(engine.calls).toEqual([{ jobId: job.id, trigger: "catch_up", missedCount: 5 }]);
    expect(repos.runs.listByJob(job.id, { limit: 10, offset: 0 })).toHaveLength(0);
    expect(report).toEqual({
      interrupted: 0,
      skipped: 0,
      executed: 1,
      jobs: [{ jobId: job.id, policy: "once", missed: 5, executed: 1 }],
    });
    expect(repos.jobs.get(job.id)?.nextRunAt).toBe(Date.parse("2026-07-06T09:00:00.000Z"));
  });

  it("caps the all policy and records the remaining runs as skipped", async () => {
    const nowMs = Date.parse("2026-07-03T23:00:00.000Z");
    const firstMissed = Date.parse("2026-07-01T00:00:00.000Z");
    const { repos, engine } = setup();
    const job = createShellJob(repos, {
      scheduleKind: "cron",
      scheduleExpr: "0 * * * *",
      catchUp: "all",
      catchUpLimit: 10,
    });
    repos.jobs.setNextRun(job.id, firstMissed);

    const report = await recoverMissedRuns({
      engine,
      jobs: repos.jobs,
      runs: repos.runs,
      meta: repos.meta,
      now: () => nowMs,
    });

    // 72 hourly occurrences, 10 recovered and the other 62 left out.
    expect(engine.calls).toHaveLength(10);
    expect(engine.calls.every((call) => call.trigger === "catch_up")).toBe(true);
    expect(engine.calls.every((call) => call.missedCount === 72)).toBe(true);

    const runs = repos.runs.listByJob(job.id, { limit: 10, offset: 0 });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "skipped", missedCount: 62 });

    expect(report).toEqual({
      interrupted: 0,
      skipped: 1,
      executed: 10,
      jobs: [{ jobId: job.id, policy: "all", missed: 72, executed: 10 }],
    });
    expect(repos.jobs.get(job.id)?.nextRunAt).toBe(Date.parse("2026-07-04T00:00:00.000Z"));
  });

  it("marks running and queued runs as interrupted exactly once", async () => {
    const nowMs = Date.parse("2026-07-01T00:00:00.000Z");
    const { repos, engine } = setup();
    const job = createShellJob(repos);
    repos.jobs.setNextRun(job.id, nowMs + 60_000);
    const running = repos.runs.create({
      jobId: job.id,
      trigger: "scheduled",
      status: "running",
    });
    const queued = repos.runs.create({
      jobId: job.id,
      trigger: "scheduled",
      status: "queued",
    });
    const spy = vi.spyOn(repos.runs, "markRunningAsInterrupted");

    const report = await recoverMissedRuns({
      engine,
      jobs: repos.jobs,
      runs: repos.runs,
      meta: repos.meta,
      now: () => nowMs,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(report.interrupted).toBe(2);
    expect(repos.runs.get(running.id)?.status).toBe("interrupted");
    expect(repos.runs.get(queued.id)?.status).toBe("interrupted");
    expect(report.jobs).toEqual([]);
  });

  it("ignores paused jobs even when their next run is due", async () => {
    const nowMs = Date.parse("2026-07-05T09:00:00.000Z");
    const { repos, engine } = setup();
    const job = createShellJob(repos, { enabled: false, catchUp: "once" });
    repos.jobs.setNextRun(job.id, nowMs - 60_000);

    const report = await recoverMissedRuns({
      engine,
      jobs: repos.jobs,
      runs: repos.runs,
      meta: repos.meta,
      now: () => nowMs,
    });

    expect(engine.calls).toHaveLength(0);
    expect(report.jobs).toEqual([]);
    expect(repos.jobs.get(job.id)?.nextRunAt).toBe(nowMs - 60_000);
  });

  it("leaves nextRunAt null after consuming a once schedule", async () => {
    const nowMs = Date.parse("2026-11-01T10:00:00.000Z");
    const instant = Date.parse("2026-11-01T09:00:00.000Z");
    const { repos, engine } = setup();
    const job = createShellJob(repos, {
      scheduleKind: "once",
      scheduleExpr: "2026-11-01T09:00:00.000Z",
      catchUp: "once",
    });
    repos.jobs.setNextRun(job.id, instant);

    const report = await recoverMissedRuns({
      engine,
      jobs: repos.jobs,
      runs: repos.runs,
      meta: repos.meta,
      now: () => nowMs,
    });

    expect(engine.calls).toEqual([{ jobId: job.id, trigger: "catch_up", missedCount: 1 }]);
    expect(report.executed).toBe(1);
    expect(repos.jobs.get(job.id)?.nextRunAt).toBeNull();
  });
});
