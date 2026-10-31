import { createRepositories, type CreateJobInput, type Repositories } from "../../src/db/index.js";
import { createEngine } from "../../src/engine/index.js";
import type {
  Engine,
  Job,
  NotificationPayload,
  Notifier,
  RunResult,
  Runner,
  RunnerKind,
  RunnerRegistry,
} from "../../src/types.js";
import { openTempDatabase } from "../db/helpers.js";

export interface FakeClock {
  now: () => number;
  advance: (ms: number) => void;
}

export interface RunnerCall {
  job: Job;
  signal: AbortSignal;
}

export type RunnerHandler = (job: Job, signal: AbortSignal) => Promise<RunResult> | RunResult;

/** Runner controlled by each test: records calls and delegates the result. */
export class FakeRunner implements Runner {
  readonly calls: RunnerCall[] = [];
  handler: RunnerHandler;
  private readonly onFinish: (() => void) | undefined;

  constructor(kind: RunnerKind, handler: RunnerHandler, onFinish?: () => void) {
    this.kind = kind;
    this.handler = handler;
    this.onFinish = onFinish;
  }

  readonly kind: RunnerKind;

  async run(job: Job, signal: AbortSignal): Promise<RunResult> {
    this.calls.push({ job, signal });
    const result = await this.handler(job, signal);
    this.onFinish?.();
    return result;
  }
}

/** Notifier whose outcome (or thrown error) each test can control. */
export class FakeNotifier implements Notifier {
  readonly calls: NotificationPayload[] = [];
  response: (payload: NotificationPayload) => Promise<boolean> = async () => true;

  async notify(payload: NotificationPayload): Promise<boolean> {
    this.calls.push(payload);
    return this.response(payload);
  }
}

export interface HarnessOptions {
  aiConcurrency?: number;
  opencode?: RunnerHandler;
  shell?: RunnerHandler;
}

export interface Harness {
  repos: Repositories;
  engine: Engine;
  opencode: FakeRunner;
  shell: FakeRunner;
  notifier: FakeNotifier;
  clock: FakeClock;
}

export function successResult(output = "ok", sessionId: string | null = null): RunResult {
  return { status: "success", exitCode: 0, output, error: null, sessionId, durationMs: 5 };
}

export function failureResult(error = "boom"): RunResult {
  return { status: "failed", exitCode: 1, output: "", error, sessionId: null, durationMs: 7 };
}

export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Polls a condition, letting pending promises settle between checks. */
export async function until(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for condition");
    }
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

export function createHarness(options: HarnessOptions = {}): Harness {
  const { db } = openTempDatabase();
  const repos = createRepositories(db);

  // Keep the fake clock close to real time: run retention prunes by wall clock.
  let current = Date.now();
  const clock: FakeClock = {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };

  const opencode = new FakeRunner(
    "opencode",
    options.opencode ?? (() => successResult("respuesta")),
    () => clock.advance(1),
  );
  const shell = new FakeRunner(
    "shell",
    options.shell ?? (() => successResult("salida shell")),
    () => clock.advance(1),
  );

  const runners: RunnerRegistry = {
    get: (kind: RunnerKind): Runner => (kind === "opencode" ? opencode : shell),
  };

  const notifier = new FakeNotifier();
  const engine = createEngine({
    jobs: repos.jobs,
    runs: repos.runs,
    messages: repos.messages,
    runners,
    notifier,
    now: clock.now,
    aiConcurrency: options.aiConcurrency,
  });

  return { repos, engine, opencode, shell, notifier, clock };
}

export function createJob(repos: Repositories, overrides: Partial<CreateJobInput> = {}): Job {
  return repos.jobs.create({
    name: "trabajo",
    runner: "opencode",
    prompt: "haz algo",
    scheduleKind: "cron",
    scheduleExpr: "* * * * *",
    notify: false,
    ...overrides,
  });
}
