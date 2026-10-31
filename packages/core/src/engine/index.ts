import { NotFoundError } from "../db/index.js";
import type { JobRepository, MessageRepository, RunRepository } from "../db/index.js";
import { shouldNotify, summarize } from "../notifications/index.js";
import type {
  Engine,
  EngineEvent,
  Job,
  Notifier,
  Run,
  RunnerRegistry,
  RunResult,
  RunStatus,
  RunTrigger,
} from "../types.js";
import { Semaphore } from "./semaphore.js";

/** Default global cap for concurrent AI (`opencode`) executions. */
const DEFAULT_AI_CONCURRENCY = 2;

/** Retention applied to the run history after every finished execution. */
const RUN_RETENTION = { maxAgeMs: 90 * 24 * 60 * 60 * 1000, maxCount: 200 };

export interface EngineDeps {
  jobs: JobRepository;
  runs: RunRepository;
  messages: MessageRepository;
  runners: RunnerRegistry;
  notifier: Notifier;
  now?: () => number;
  aiConcurrency?: number;
}

/** In-memory bookkeeping for a run that is queued or executing. */
interface Execution {
  jobId: string;
  controller: AbortController;
  done: Promise<void>;
  resolveDone: () => void;
}

function resolveAiConcurrency(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_AI_CONCURRENCY;
  }

  return Math.max(1, Math.floor(value));
}

function abortMessage(signal: AbortSignal): string {
  const reason: unknown = signal.reason;

  if (typeof reason === "string" && reason.length > 0) {
    return reason;
  }

  if (reason instanceof Error && reason.message.length > 0) {
    return reason.message;
  }

  return "cancelled";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createEngine(deps: EngineDeps): Engine {
  const now = deps.now ?? (() => Date.now());
  const semaphore = new Semaphore(resolveAiConcurrency(deps.aiConcurrency));
  const listeners = new Set<(event: EngineEvent) => void>();
  const executions = new Set<Execution>();
  const executionsByJob = new Map<string, Execution>();

  function emit(event: EngineEvent): void {
    // Snapshot so listeners can unsubscribe (or subscribe) while being notified.
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        // A broken listener must never break the engine.
      }
    }
  }

  function registerExecution(jobId: string, controller: AbortController): Execution {
    let resolveDone: () => void = () => {
      // Replaced synchronously by the promise executor below.
    };
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    const execution: Execution = { jobId, controller, done, resolveDone };
    executions.add(execution);
    executionsByJob.set(jobId, execution);
    return execution;
  }

  function unregisterExecution(execution: Execution): void {
    executions.delete(execution);
    if (executionsByJob.get(execution.jobId) === execution) {
      executionsByJob.delete(execution.jobId);
    }
    execution.resolveDone();
  }

  /**
   * Waits until the job has no in-memory execution left. Re-checks after every
   * wake-up because several dispatches may be waiting for the same job.
   */
  async function waitForJobIdle(jobId: string): Promise<void> {
    for (;;) {
      const execution = executionsByJob.get(jobId);
      if (execution === undefined) {
        return;
      }
      await execution.done;
    }
  }

  function finishSkipped(job: Job, trigger: RunTrigger, missedCount: number): Run {
    const at = now();
    const created = deps.runs.create({
      jobId: job.id,
      trigger,
      status: "skipped",
      missedCount,
    });

    // The repository only stamps `started_at` through markStarted; a skipped
    // run is transiently running and then persisted as skipped.
    deps.runs.markStarted(created.id, at);
    const run = deps.runs.finish(created.id, {
      status: "skipped",
      finishedAt: at,
      durationMs: 0,
      exitCode: null,
      output: null,
      error: null,
      sessionId: null,
      notificationDelivered: null,
    });

    emit({ type: "run.finished", run });
    return run;
  }

  /** Persists an execution cancelled before its runner was invoked. */
  function finishBeforeStart(job: Job, run: Run, signal: AbortSignal): Run {
    const finishedAt = now();
    const finished = deps.runs.finish(run.id, {
      status: "interrupted",
      finishedAt,
      durationMs: 0,
      exitCode: null,
      output: null,
      error: abortMessage(signal),
      sessionId: null,
      notificationDelivered: null,
    });

    deps.jobs.recordOutcome(job.id, "interrupted", finishedAt);
    deps.runs.pruneForJob(job.id, RUN_RETENTION);
    emit({ type: "run.finished", run: finished });
    return finished;
  }

  async function invokeRunner(
    job: Job,
    signal: AbortSignal,
    startedAt: number,
  ): Promise<RunResult> {
    try {
      return await deps.runners.get(job.runner).run(job, signal);
    } catch (error) {
      return {
        status: signal.aborted ? "interrupted" : "failed",
        exitCode: null,
        output: "",
        error: errorMessage(error),
        sessionId: null,
        durationMs: Math.max(0, now() - startedAt),
      };
    }
  }

  async function finishRun(
    job: Job,
    run: Run,
    signal: AbortSignal,
    startedAt: number,
    result: RunResult,
  ): Promise<Run> {
    const finishedAt = now();
    // Cancellation wins over whatever the runner reported: a killed or
    // cancelled run must stay `interrupted` and carry the abort reason.
    const status: RunStatus = signal.aborted ? "interrupted" : result.status;
    const error = signal.aborted ? abortMessage(signal) : result.error;
    const output = result.output;
    const durationMs =
      Number.isFinite(result.durationMs) && result.durationMs >= 0
        ? Math.round(result.durationMs)
        : Math.max(0, finishedAt - startedAt);

    if (output.length > 0) {
      deps.messages.create({
        jobId: job.id,
        runId: run.id,
        role: "assistant",
        content: output,
        createdAt: finishedAt,
      });
    }

    if (job.sessionMode === "continuous" && result.sessionId) {
      deps.jobs.update(job.id, { sessionId: result.sessionId });
    }

    // Persist the terminal state first: a slow or failing notifier must never
    // keep the run active nor change its outcome.
    let finished = deps.runs.finish(run.id, {
      status,
      finishedAt,
      durationMs,
      exitCode: result.exitCode,
      output,
      error,
      sessionId: result.sessionId,
      notificationDelivered: null,
      usage: result.usage ?? null,
    });

    deps.jobs.recordOutcome(job.id, status, finishedAt);

    if (shouldNotify(job, status)) {
      let notificationDelivered = false;
      try {
        notificationDelivered = await deps.notifier.notify({
          jobName: job.name,
          status,
          durationMs,
          summary: summarize(output.length > 0 ? output : (error ?? "")),
          error,
        });
      } catch {
        notificationDelivered = false;
      }

      finished = deps.runs.finish(run.id, {
        status,
        finishedAt,
        durationMs,
        exitCode: result.exitCode,
        output,
        error,
        sessionId: result.sessionId,
        notificationDelivered,
        usage: result.usage ?? null,
      });
    }

    deps.runs.pruneForJob(job.id, RUN_RETENTION);
    emit({ type: "run.finished", run: finished });
    return finished;
  }

  async function startRun(job: Job, trigger: RunTrigger, missedCount: number): Promise<Run> {
    let run = deps.runs.create({
      jobId: job.id,
      trigger,
      status: job.runner === "opencode" ? "queued" : "running",
      missedCount,
    });

    const controller = new AbortController();
    const execution = registerExecution(job.id, controller);
    let acquired = false;

    try {
      if (job.runner === "opencode") {
        emit({ type: "run.queued", run });

        try {
          await semaphore.acquire(controller.signal);
          acquired = true;
        } catch (error) {
          if (!controller.signal.aborted) {
            throw error;
          }
          return finishBeforeStart(job, run, controller.signal);
        }
      }

      const startedAt = now();
      run = deps.runs.markStarted(run.id, startedAt);
      emit({ type: "run.started", run });

      if (job.runner === "opencode" && job.prompt !== null) {
        deps.messages.create({
          jobId: job.id,
          runId: run.id,
          role: "user",
          content: job.prompt,
          createdAt: now(),
        });
      }

      const result = await invokeRunner(job, controller.signal, startedAt);
      return await finishRun(job, run, controller.signal, startedAt, result);
    } finally {
      if (acquired) {
        semaphore.release();
      }
      unregisterExecution(execution);
    }
  }

  async function executeJob(
    job: Job,
    trigger: RunTrigger,
    opts?: { missedCount?: number },
  ): Promise<Run> {
    const missedCount = opts?.missedCount ?? 0;

    if (deps.runs.activeByJob(job.id) !== null) {
      if (job.overlap === "skip") {
        return finishSkipped(job, trigger, missedCount);
      }

      if (job.overlap === "kill") {
        // A persisted active run without in-memory execution is stale; there
        // is nothing to abort, but the wait below is a no-op too.
        executionsByJob.get(job.id)?.controller.abort("overlap: kill");
      }

      await waitForJobIdle(job.id);
    }

    return startRun(job, trigger, missedCount);
  }

  return {
    async dispatch(job: Job, trigger: RunTrigger, opts?: { missedCount?: number }) {
      if (!job.enabled) {
        return null;
      }

      return executeJob(job, trigger, opts);
    },

    async runNow(jobId: string): Promise<Run> {
      const job = deps.jobs.get(jobId);
      if (job === null) {
        throw new NotFoundError(`No se encontró el cron ${jobId}.`);
      }

      return executeJob(job, "manual");
    },

    async cancelAll(): Promise<void> {
      // Loop because a dispatch waiting on an overlap queue may start a new
      // execution while the previous ones are being cancelled.
      for (;;) {
        const pending = [...executions];
        if (pending.length === 0) {
          return;
        }

        for (const execution of pending) {
          execution.controller.abort("cancelled");
        }

        await Promise.all(pending.map((execution) => execution.done));
      }
    },

    onEvent(listener: (event: EngineEvent) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
