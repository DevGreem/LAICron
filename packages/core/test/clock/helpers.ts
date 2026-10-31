import { createRepositories, type CreateJobInput, type Repositories } from "../../src/db/index.js";
import type { Engine, Job, Run, RunTrigger } from "../../src/types.js";
import { openTempDatabase } from "../db/helpers.js";

export interface DispatchCall {
  jobId: string;
  trigger: RunTrigger;
  missedCount: number | undefined;
}

export type DispatchHandler = (
  job: Job,
  trigger: RunTrigger,
  opts?: { missedCount?: number },
) => Promise<Run | null>;

let runCounter = 0;

/** Minimal Run returned by the fake engine; persistence is not its job. */
export function syntheticRun(job: Job, trigger: RunTrigger, missedCount = 0): Run {
  runCounter += 1;
  return {
    id: `run-${runCounter}`,
    jobId: job.id,
    trigger,
    status: "queued",
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    exitCode: null,
    output: null,
    error: null,
    sessionId: null,
    missedCount,
    notificationDelivered: null,
  };
}

/** Engine double that records every dispatch and can hold one open on demand. */
export class FakeEngine implements Engine {
  readonly calls: DispatchCall[] = [];
  handler: DispatchHandler | null = null;

  async dispatch(
    job: Job,
    trigger: RunTrigger,
    opts?: { missedCount?: number },
  ): Promise<Run | null> {
    this.calls.push({ jobId: job.id, trigger, missedCount: opts?.missedCount });
    if (this.handler !== null) {
      return this.handler(job, trigger, opts);
    }
    return syntheticRun(job, trigger, opts?.missedCount ?? 0);
  }

  runNow(jobId: string): Promise<Run> {
    return Promise.reject(new Error(`runNow no está disponible en este doble (${jobId}).`));
  }

  cancelAll(): Promise<void> {
    return Promise.resolve();
  }

  onEvent(): () => void {
    return () => undefined;
  }
}

export interface Fixture {
  repos: Repositories;
  engine: FakeEngine;
}

export function setup(): Fixture {
  const { db } = openTempDatabase();
  return { repos: createRepositories(db), engine: new FakeEngine() };
}

export function createShellJob(repos: Repositories, overrides: Partial<CreateJobInput> = {}): Job {
  return repos.jobs.create({
    name: "Trabajo de prueba",
    runner: "shell",
    command: "true",
    scheduleKind: "interval",
    scheduleExpr: "15m",
    timezone: "UTC",
    ...overrides,
  });
}
