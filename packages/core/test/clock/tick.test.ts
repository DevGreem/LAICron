import { afterEach, describe, expect, it, vi } from "vitest";

import { createClock } from "../../src/clock/index.js";
import type { Clock } from "../../src/types.js";
import { cleanupTempDatabases } from "../db/helpers.js";
import { createShellJob, setup, syntheticRun } from "./helpers.js";

const T0 = Date.parse("2026-07-01T00:00:00.000Z");
const HOUR = 60 * 60_000;
const FIFTEEN_MINUTES = 15 * 60_000;
const clocks: Clock[] = [];

function track(clock: Clock): Clock {
  clocks.push(clock);
  return clock;
}

/** Lets every queued background dispatch/policy continuation run. */
async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
}

afterEach(async () => {
  for (const clock of clocks.splice(0)) {
    await clock.stop();
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanupTempDatabases();
});

describe("createClock", () => {
  it("dispatches a due job once and recalculates nextRunAt from now", async () => {
    vi.useFakeTimers({ now: T0 + 3_000 });
    const { repos, engine } = setup();
    const job = createShellJob(repos, { scheduleKind: "interval", scheduleExpr: "15m" });
    repos.jobs.setNextRun(job.id, T0);

    const clock = track(
      createClock({
        engine,
        jobs: repos.jobs,
        runs: repos.runs,
        meta: repos.meta,
        now: () => Date.now(),
        intervalMs: 1_000,
      }),
    );

    await clock.start();

    expect(engine.calls).toHaveLength(1);
    expect(engine.calls[0]).toEqual({
      jobId: job.id,
      trigger: "scheduled",
      missedCount: undefined,
    });
    // The next run starts from the tick instant, not from the old schedule.
    expect(repos.jobs.get(job.id)?.nextRunAt).toBe(T0 + 3_000 + FIFTEEN_MINUTES);
  });

  it("dispatches two due jobs in next_run_at order", async () => {
    vi.useFakeTimers({ now: T0 });
    const { repos, engine } = setup();
    const later = createShellJob(repos, { name: "Más tarde" });
    const earlier = createShellJob(repos, { name: "Antes" });
    repos.jobs.setNextRun(later.id, T0 - 1_000);
    repos.jobs.setNextRun(earlier.id, T0 - 5_000);

    const clock = track(
      createClock({
        engine,
        jobs: repos.jobs,
        runs: repos.runs,
        meta: repos.meta,
        now: () => Date.now(),
        intervalMs: 1_000,
      }),
    );

    await clock.start();

    expect(engine.calls.map((call) => call.jobId)).toEqual([earlier.id, later.id]);
  });

  it("does not dispatch a job whose next run is in the future", async () => {
    vi.useFakeTimers({ now: T0 });
    const { repos, engine } = setup();
    const job = createShellJob(repos);
    repos.jobs.setNextRun(job.id, T0 + 60_000);

    const clock = track(
      createClock({
        engine,
        jobs: repos.jobs,
        runs: repos.runs,
        meta: repos.meta,
        now: () => Date.now(),
        intervalMs: 1_000,
      }),
    );

    await clock.start();

    expect(engine.calls).toHaveLength(0);
    expect(repos.jobs.get(job.id)?.nextRunAt).toBe(T0 + 60_000);
    expect(repos.meta.get("heartbeat_at")).toBe(String(T0));
  });

  it("writes the heartbeat on every tick and exposes lastTickAt", async () => {
    vi.useFakeTimers({ now: T0 });
    const { repos, engine } = setup();
    const job = createShellJob(repos);
    repos.jobs.setNextRun(job.id, T0 + 60_000);

    const clock = track(
      createClock({
        engine,
        jobs: repos.jobs,
        runs: repos.runs,
        meta: repos.meta,
        now: () => Date.now(),
        intervalMs: 1_000,
      }),
    );

    expect(clock.lastTickAt()).toBeNull();

    await clock.start();
    expect(repos.meta.get("heartbeat_at")).toBe(String(T0));
    expect(clock.lastTickAt()).toBe(T0);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(repos.meta.get("heartbeat_at")).toBe(String(T0 + 1_000));
    expect(clock.lastTickAt()).toBe(T0 + 1_000);
  });

  it("does not block the tick, the heartbeat or stop on a slow dispatch", async () => {
    vi.useFakeTimers({ now: T0 });
    const { repos, engine } = setup();
    const slow = createShellJob(repos, { name: "Lento" });
    const fast = createShellJob(repos, { name: "Rápido" });
    repos.jobs.setNextRun(slow.id, T0 - 2_000);
    repos.jobs.setNextRun(fast.id, T0 - 1_000);

    const releases: Array<() => void> = [];
    engine.handler = (job, trigger) =>
      new Promise((resolve) => {
        releases.push(() => {
          resolve(syntheticRun(job, trigger));
        });
      });

    const clock = track(
      createClock({
        engine,
        jobs: repos.jobs,
        runs: repos.runs,
        meta: repos.meta,
        now: () => Date.now(),
        intervalMs: 1_000,
      }),
    );

    await clock.start();

    // Both jobs were dispatched even though neither run finished.
    expect(engine.calls.map((call) => call.jobId)).toEqual([slow.id, fast.id]);
    expect(repos.meta.get("heartbeat_at")).toBe(String(T0));
    expect(clock.lastTickAt()).toBe(T0);

    // stop() only waits for the tick, never for the background runs.
    await clock.stop();
    expect(releases).toHaveLength(2);

    for (const release of releases) {
      release();
    }
    await flushMicrotasks();
  });

  it("applies the none policy when the tick finds a suspension gap", async () => {
    vi.useFakeTimers({ now: T0 + 12 * HOUR });
    const { repos, engine } = setup();
    const firstMissed = T0 + 6 * HOUR;
    const job = createShellJob(repos, {
      scheduleKind: "cron",
      scheduleExpr: "0 * * * *",
      catchUp: "none",
    });
    repos.jobs.setNextRun(job.id, firstMissed);

    const clock = track(
      createClock({
        engine,
        jobs: repos.jobs,
        runs: repos.runs,
        meta: repos.meta,
        now: () => Date.now(),
        intervalMs: 1_000,
      }),
    );

    await clock.start();

    // 06:00 through 12:00 inclusive: seven hourly occurrences missed.
    expect(engine.calls).toHaveLength(0);
    const runs = repos.runs.listByJob(job.id, { limit: 10, offset: 0 });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      trigger: "catch_up",
      status: "skipped",
      missedCount: 7,
      finishedAt: T0 + 12 * HOUR,
      durationMs: 0,
    });
    expect(repos.jobs.get(job.id)?.nextRunAt).toBe(T0 + 13 * HOUR);
  });

  it("applies the once policy when the tick finds a suspension gap", async () => {
    vi.useFakeTimers({ now: T0 + 12 * HOUR });
    const { repos, engine } = setup();
    const job = createShellJob(repos, {
      scheduleKind: "cron",
      scheduleExpr: "0 * * * *",
      catchUp: "once",
    });
    repos.jobs.setNextRun(job.id, T0 + 6 * HOUR);

    const clock = track(
      createClock({
        engine,
        jobs: repos.jobs,
        runs: repos.runs,
        meta: repos.meta,
        now: () => Date.now(),
        intervalMs: 1_000,
      }),
    );

    await clock.start();
    await flushMicrotasks();

    expect(engine.calls).toHaveLength(1);
    expect(engine.calls[0]).toMatchObject({
      jobId: job.id,
      trigger: "catch_up",
      missedCount: 7,
    });
    expect(repos.runs.listByJob(job.id, { limit: 10, offset: 0 })).toHaveLength(0);
    expect(repos.jobs.get(job.id)?.nextRunAt).toBe(T0 + 13 * HOUR);
  });

  it("applies the all policy with its limit when the tick finds a suspension gap", async () => {
    vi.useFakeTimers({ now: T0 + 12 * HOUR });
    const { repos, engine } = setup();
    const job = createShellJob(repos, {
      scheduleKind: "cron",
      scheduleExpr: "0 * * * *",
      catchUp: "all",
      catchUpLimit: 3,
    });
    repos.jobs.setNextRun(job.id, T0 + 6 * HOUR);

    const clock = track(
      createClock({
        engine,
        jobs: repos.jobs,
        runs: repos.runs,
        meta: repos.meta,
        now: () => Date.now(),
        intervalMs: 1_000,
      }),
    );

    await clock.start();
    await flushMicrotasks();

    expect(engine.calls).toHaveLength(3);
    expect(engine.calls.every((call) => call.trigger === "catch_up")).toBe(true);
    expect(engine.calls.every((call) => call.missedCount === 7)).toBe(true);

    const runs = repos.runs.listByJob(job.id, { limit: 10, offset: 0 });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "skipped", missedCount: 4 });
    expect(repos.jobs.get(job.id)?.nextRunAt).toBe(T0 + 13 * HOUR);
  });

  it("reports a failing job and keeps dispatching the rest", async () => {
    vi.useFakeTimers({ now: T0 });
    const { repos, engine } = setup();
    const failing = createShellJob(repos, { name: "Falla" });
    const healthy = createShellJob(repos, { name: "Sigue" });
    repos.jobs.setNextRun(failing.id, T0 - 2_000);
    repos.jobs.setNextRun(healthy.id, T0 - 1_000);

    const errors: unknown[] = [];
    engine.handler = async (job, trigger) => {
      if (job.id === failing.id) {
        throw new Error("boom");
      }
      return syntheticRun(job, trigger);
    };

    const clock = track(
      createClock({
        engine,
        jobs: repos.jobs,
        runs: repos.runs,
        meta: repos.meta,
        now: () => Date.now(),
        intervalMs: 1_000,
        onError: (error) => errors.push(error),
      }),
    );

    await clock.start();
    await flushMicrotasks();

    expect(errors).toHaveLength(1);
    expect(engine.calls.map((call) => call.jobId)).toEqual([failing.id, healthy.id]);
    // The failing job was advanced before dispatching, so it will not retry
    // the same occurrence on the next tick.
    expect(repos.jobs.get(failing.id)?.nextRunAt).toBe(T0 + FIFTEEN_MINUTES);
  });
});
