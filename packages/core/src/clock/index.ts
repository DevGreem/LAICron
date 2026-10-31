import type { JobRepository, MetaRepository, RunRepository } from "../db/index.js";
import { computeNextRun, countMissedRuns } from "../schedule/index.js";
import type { CatchUpPolicy, Clock, Engine, Job } from "../types.js";

export interface ClockDeps {
  engine: Engine;
  jobs: JobRepository;
  runs: RunRepository;
  meta: MetaRepository;
  now?: () => number;
  intervalMs?: number;
  onError?: (error: unknown) => void;
}

export interface RecoveryReport {
  interrupted: number;
  skipped: number;
  executed: number;
  jobs: Array<{ jobId: string; policy: CatchUpPolicy; missed: number; executed: number }>;
}

const DEFAULT_INTERVAL_MS = 20_000;
const HEARTBEAT_KEY = "heartbeat_at";
// The recovery report needs the real number of missed runs (for example 72),
// not the catch-up limit, so counting continues past `catchUpLimit + 1`. This
// ceiling keeps startup bounded for pathological gaps (a minutely cron left
// offline for months) while staying far above the maximum catch-up limit.
const MAX_MISSED_COUNT = 10_000;

type ErrorReporter = (error: unknown) => void;

function createErrorReporter(onError: ((error: unknown) => void) | undefined): ErrorReporter {
  if (onError !== undefined) {
    return (error: unknown): void => {
      onError(error);
    };
  }
  return (error: unknown): void => {
    console.error("Error del reloj de LAICron:", error);
  };
}

/**
 * Counts every missed occurrence so the report and the skipped run can say
 * how many runs were left out. The first pass stays bounded by the configured
 * limit; only a saturated job is counted further.
 */
function countMissed(job: Job, firstMissedMs: number, nowMs: number): number {
  const capped = countMissedRuns(job, firstMissedMs, nowMs, job.catchUpLimit + 1);
  if (capped <= job.catchUpLimit) {
    return capped;
  }
  return countMissedRuns(job, firstMissedMs, nowMs, MAX_MISSED_COUNT);
}

function recordSkippedRun(
  runs: RunRepository,
  jobId: string,
  missedCount: number,
  nowMs: number,
): void {
  const run = runs.create({ jobId, trigger: "catch_up", status: "skipped", missedCount });
  runs.finish(run.id, {
    status: "skipped",
    finishedAt: nowMs,
    durationMs: 0,
    exitCode: null,
    output: null,
    error: null,
    sessionId: null,
    notificationDelivered: null,
  });
}

async function dispatchCatchUp(
  engine: Engine,
  job: Job,
  missed: number,
  reportError: ErrorReporter,
): Promise<boolean> {
  try {
    await engine.dispatch(job, "catch_up", { missedCount: missed });
    return true;
  } catch (error) {
    reportError(error);
    return false;
  }
}

interface PolicyResult {
  executed: number;
  skipped: number;
}

/**
 * Applies a job's configured catch-up policy. The caller owns `next_run_at`:
 * the tick advances it before calling this helper (so a background catch-up
 * cannot retrigger the same occurrence), while recovery advances it after the
 * policy finishes. Keeping the write out of this helper avoids advancing the
 * schedule twice.
 */
async function applyCatchUpPolicy(
  deps: Omit<ClockDeps, "intervalMs">,
  job: Job,
  missed: number,
  nowMs: number,
  reportError: ErrorReporter,
): Promise<PolicyResult> {
  switch (job.catchUp) {
    case "none": {
      try {
        recordSkippedRun(deps.runs, job.id, missed, nowMs);
        return { executed: 0, skipped: 1 };
      } catch (error) {
        reportError(error);
        return { executed: 0, skipped: 0 };
      }
    }

    case "once": {
      const dispatched = await dispatchCatchUp(deps.engine, job, missed, reportError);
      return { executed: dispatched ? 1 : 0, skipped: 0 };
    }

    case "all": {
      // Sequential on purpose: catch-up runs of the same job must not race.
      const limit = Math.min(missed, job.catchUpLimit);
      let executed = 0;
      for (let index = 0; index < limit; index += 1) {
        if (await dispatchCatchUp(deps.engine, job, missed, reportError)) {
          executed += 1;
        }
      }

      const remaining = missed - limit;
      let skipped = 0;
      if (remaining > 0) {
        try {
          recordSkippedRun(deps.runs, job.id, remaining, nowMs);
          skipped = 1;
        } catch (error) {
          reportError(error);
        }
      }
      return { executed, skipped };
    }
  }
}

/**
 * Builds the daemon clock. `start()` runs one tick immediately and then one
 * tick per interval; `stop()` clears the timer and waits for the tick in
 * progress. Ticks never overlap: while one is running, the next is skipped.
 */
export function createClock(deps: ClockDeps): Clock {
  const now = deps.now ?? Date.now;
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const reportError = createErrorReporter(deps.onError);

  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<void> | null = null;
  let starting = false;
  let stopRequested = false;
  let lastTick: number | null = null;

  async function runTick(): Promise<void> {
    const tickedAt = now();

    for (const job of deps.jobs.dueBefore(tickedAt)) {
      try {
        const firstMissedMs = job.nextRunAt;
        // The tick owns next_run_at: advance it before dispatching so neither a
        // slow runner nor a background catch-up can trigger the same occurrence
        // again on the next tick.
        const nextRunAt = computeNextRun(job, tickedAt, { lastRunAt: job.lastRunAt });
        deps.jobs.setNextRun(job.id, nextRunAt);

        // Two or more occurrences in the gap mean the daemon was stopped or the
        // machine was suspended: honor the job policy instead of pretending
        // this was a single scheduled run.
        if (firstMissedMs !== null && countMissedRuns(job, firstMissedMs, tickedAt, 2) >= 2) {
          const missed = countMissed(job, firstMissedMs, tickedAt);
          // Fire-and-forget: a catch-up policy must not block the tick, the
          // heartbeat or the remaining due jobs.
          void applyCatchUpPolicy(deps, job, missed, tickedAt, reportError).catch(reportError);
        } else {
          // Fire-and-forget: dispatch returns when the run is queued, but even
          // a slow engine must not delay the tick or stop().
          void deps.engine.dispatch(job, "scheduled").catch(reportError);
        }
      } catch (error) {
        // One broken job must not stop the remaining due jobs.
        reportError(error);
      }
    }

    deps.meta.set(HEARTBEAT_KEY, String(tickedAt));
    lastTick = tickedAt;
  }

  function tick(): Promise<void> {
    if (inFlight !== null) {
      // The previous tick is still running; skip this one.
      return inFlight;
    }

    const current = runTick().finally(() => {
      if (inFlight === current) {
        inFlight = null;
      }
    });
    inFlight = current;
    return current;
  }

  async function start(): Promise<void> {
    if (timer !== null || starting) {
      return;
    }

    stopRequested = false;
    starting = true;
    try {
      await tick();
      if (!stopRequested && timer === null) {
        timer = setInterval(() => {
          void tick().catch(reportError);
        }, intervalMs);
      }
    } finally {
      starting = false;
    }
  }

  async function stop(): Promise<void> {
    stopRequested = true;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }

    const pending = inFlight;
    if (pending !== null) {
      try {
        await pending;
      } catch (error) {
        reportError(error);
      }
    }
  }

  return {
    start,
    stop,
    lastTickAt: (): number | null => lastTick,
  };
}

/**
 * Marks runs interrupted by the previous daemon and applies the configured
 * catch-up policy to every enabled job whose next run is already due. Must be
 * called before `clock.start()`.
 */
export async function recoverMissedRuns(
  deps: Omit<ClockDeps, "intervalMs">,
): Promise<RecoveryReport> {
  const now = deps.now ?? Date.now;
  const reportError = createErrorReporter(deps.onError);
  const nowMs = now();

  const interrupted = deps.runs.markRunningAsInterrupted(nowMs);
  const report: RecoveryReport = { interrupted, skipped: 0, executed: 0, jobs: [] };

  for (const job of deps.jobs.list({ enabled: true })) {
    const firstMissedMs = job.nextRunAt;
    if (firstMissedMs === null || firstMissedMs > nowMs) {
      continue;
    }

    let missed: number;
    try {
      missed = countMissed(job, firstMissedMs, nowMs);
    } catch (error) {
      reportError(error);
      continue;
    }

    const result = await applyCatchUpPolicy(deps, job, missed, nowMs, reportError);
    report.executed += result.executed;
    report.skipped += result.skipped;
    report.jobs.push({
      jobId: job.id,
      policy: job.catchUp,
      missed,
      executed: result.executed,
    });

    try {
      const nextRunAt = computeNextRun(job, nowMs, { lastRunAt: job.lastRunAt });
      deps.jobs.setNextRun(job.id, nextRunAt);
    } catch (error) {
      reportError(error);
    }
  }

  return report;
}
