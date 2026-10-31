import { afterEach, describe, expect, it } from "vitest";

import { NotFoundError } from "../../src/db/index.js";
import type { EngineEvent, Job, RunResult } from "../../src/types.js";
import { cleanupTempDatabases } from "../db/helpers.js";
import {
  createHarness,
  createJob,
  deferred,
  failureResult,
  successResult,
  until,
} from "./helpers.js";

afterEach(cleanupTempDatabases);

describe("engine execution", () => {
  it("runs a job, persists its messages and records the outcome", async () => {
    const harness = createHarness();
    const job = createJob(harness.repos, { name: "Resumen", prompt: "resume esto" });
    const events: EngineEvent[] = [];
    harness.engine.onEvent((event) => events.push(event));

    const run = await harness.engine.dispatch(job, "scheduled");

    expect(run).not.toBeNull();
    expect(run).toMatchObject({
      jobId: job.id,
      trigger: "scheduled",
      status: "success",
      exitCode: 0,
      output: "respuesta",
      error: null,
      missedCount: 0,
      notificationDelivered: null,
    });
    expect(run?.startedAt).not.toBeNull();
    expect(run?.finishedAt).not.toBeNull();
    expect(run?.durationMs).toBe(5);
    expect(harness.repos.runs.get(run?.id ?? "")).toEqual(run);

    const messages = harness.repos.messages.listByRun(run?.id ?? "");
    expect(messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "resume esto"],
      ["assistant", "respuesta"],
    ]);

    const updated = harness.repos.jobs.get(job.id);
    expect(updated?.lastStatus).toBe("success");
    expect(updated?.lastRunAt).toBe(run?.finishedAt);

    expect(events.map((event) => event.type)).toEqual([
      "run.queued",
      "run.started",
      "run.finished",
    ]);
  });

  it("skips a dispatch when the job is still running", async () => {
    const harness = createHarness();
    const gate = deferred<RunResult>();
    harness.opencode.handler = () => gate.promise;
    const job = createJob(harness.repos, { overlap: "skip" });

    const first = harness.engine.dispatch(job, "scheduled");
    await until(() => harness.opencode.calls.length === 1);

    const second = await harness.engine.dispatch(job, "catch_up", { missedCount: 3 });

    expect(second).toMatchObject({
      jobId: job.id,
      trigger: "catch_up",
      status: "skipped",
      missedCount: 3,
      durationMs: 0,
      exitCode: null,
      output: null,
      error: null,
      notificationDelivered: null,
    });
    expect(second?.startedAt).toBe(second?.finishedAt);
    expect(harness.opencode.calls).toHaveLength(1);

    gate.resolve(successResult("primera"));
    const firstRun = await first;
    expect(firstRun?.status).toBe("success");
    expect(harness.opencode.calls).toHaveLength(1);
  });

  it("queues overlapping dispatches and runs them one after another", async () => {
    const harness = createHarness();
    const gates = [deferred<RunResult>(), deferred<RunResult>()];
    let call = 0;
    let active = 0;
    let peak = 0;

    harness.opencode.handler = async () => {
      const gate = gates[call];
      call += 1;
      if (gate === undefined) {
        throw new Error("unexpected runner call");
      }

      active += 1;
      peak = Math.max(peak, active);
      try {
        return await gate.promise;
      } finally {
        active -= 1;
      }
    };

    const job = createJob(harness.repos, { overlap: "queue" });
    const first = harness.engine.dispatch(job, "scheduled");
    await until(() => harness.opencode.calls.length === 1);
    const firstRunId = harness.repos.runs.activeByJob(job.id)?.id;

    const second = harness.engine.dispatch(job, "scheduled");

    // While the first run is blocked the second one must not start.
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(harness.opencode.calls).toHaveLength(1);

    gates[0]?.resolve(successResult("primera"));
    await until(() => harness.opencode.calls.length === 2);

    const firstStored = harness.repos.runs.get(firstRunId ?? "");
    expect(firstStored?.status).toBe("success");

    gates[1]?.resolve(successResult("segunda"));
    const runs = await Promise.all([first, second]);

    expect(runs.map((run) => run?.status)).toEqual(["success", "success"]);
    expect(runs.map((run) => run?.output)).toEqual(["primera", "segunda"]);
    expect(peak).toBe(1);
  });

  it("kills the active execution when the overlap policy is kill", async () => {
    const harness = createHarness();
    let call = 0;

    harness.opencode.handler = (job, signal) => {
      call += 1;
      if (call > 1) {
        return successResult("segunda");
      }

      return new Promise<RunResult>((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            resolve({
              status: "interrupted",
              exitCode: null,
              output: "parcial",
              error: "aborted",
              sessionId: null,
              durationMs: 2,
            });
          },
          { once: true },
        );
      });
    };

    const job = createJob(harness.repos, { overlap: "kill" });
    const firstPromise = harness.engine.dispatch(job, "scheduled");
    await until(() => harness.opencode.calls.length === 1);
    const firstRunId = harness.repos.runs.activeByJob(job.id)?.id;

    const second = await harness.engine.dispatch(job, "scheduled");
    const first = await firstPromise;

    expect(first).toMatchObject({
      id: firstRunId,
      status: "interrupted",
      error: "overlap: kill",
      output: "parcial",
    });
    expect(second).toMatchObject({ status: "success", output: "segunda" });
    expect(harness.opencode.calls).toHaveLength(2);
    expect(harness.repos.runs.get(firstRunId ?? "")?.status).toBe("interrupted");
  });

  it("forces interrupted when a killed runner ignores the abort", async () => {
    const harness = createHarness();
    let call = 0;

    harness.opencode.handler = (job, signal) => {
      call += 1;
      if (call > 1) {
        return successResult("segunda");
      }

      return new Promise<RunResult>((resolve) => {
        signal.addEventListener("abort", () => resolve(successResult("ignorado")), { once: true });
      });
    };

    const job = createJob(harness.repos, { overlap: "kill" });
    const firstPromise = harness.engine.dispatch(job, "scheduled");
    await until(() => harness.opencode.calls.length === 1);

    const second = await harness.engine.dispatch(job, "scheduled");
    const first = await firstPromise;

    expect(first).toMatchObject({ status: "interrupted", error: "overlap: kill" });
    expect(second).toMatchObject({ status: "success", output: "segunda" });
  });

  it("caps concurrent AI executions and starts the queued one on release", async () => {
    const harness = createHarness({ aiConcurrency: 2 });
    interface PendingRun {
      job: Job;
      finish: () => void;
    }
    const pending: PendingRun[] = [];
    let active = 0;
    let peak = 0;

    harness.opencode.handler = (job) =>
      new Promise<RunResult>((resolve) => {
        active += 1;
        peak = Math.max(peak, active);
        pending.push({
          job,
          finish: () => {
            active -= 1;
            resolve(successResult(`done-${job.id}`));
          },
        });
      });

    const jobs = [
      createJob(harness.repos, { name: "uno" }),
      createJob(harness.repos, { name: "dos" }),
      createJob(harness.repos, { name: "tres" }),
    ];
    const promises = jobs.map((job) => harness.engine.dispatch(job, "scheduled"));

    await until(() => pending.length === 2);
    expect(peak).toBe(2);

    const thirdRuns = harness.repos.runs.listByJob(jobs[2]?.id ?? "", { limit: 10, offset: 0 });
    expect(thirdRuns[0]?.status).toBe("queued");

    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(pending).toHaveLength(2);

    pending[0]?.finish();
    await until(() => pending.length === 3);
    expect(peak).toBe(2);

    pending[1]?.finish();
    pending[2]?.finish();
    const runs = await Promise.all(promises);

    expect(runs.map((run) => run?.status)).toEqual(["success", "success", "success"]);
  });

  it("lets a shell run without consuming an AI slot", async () => {
    const harness = createHarness({ aiConcurrency: 1 });
    const gate = deferred<RunResult>();
    harness.opencode.handler = () => gate.promise;

    const opencodeJob = createJob(harness.repos, { name: "ia" });
    const shellJob = createJob(harness.repos, {
      name: "shell",
      runner: "shell",
      command: "echo hola",
      prompt: null,
    });

    const opencodePromise = harness.engine.dispatch(opencodeJob, "scheduled");
    await until(() => harness.opencode.calls.length === 1);

    const shellRun = await harness.engine.dispatch(shellJob, "scheduled");

    expect(shellRun?.status).toBe("success");
    expect(harness.shell.calls).toHaveLength(1);
    expect(harness.opencode.calls[0]?.signal.aborted).toBe(false);

    gate.resolve(successResult("ia"));
    const opencodeRun = await opencodePromise;
    expect(opencodeRun?.status).toBe("success");
  });
});

describe("engine triggers and history", () => {
  it("persists scheduled, catch_up and manual triggers with their missed count", async () => {
    const harness = createHarness();
    const scheduledJob = createJob(harness.repos, { name: "programado" });
    const catchUpJob = createJob(harness.repos, { name: "recuperado" });
    const manualJob = createJob(harness.repos, { name: "manual" });

    const scheduled = await harness.engine.dispatch(scheduledJob, "scheduled");
    const catchUp = await harness.engine.dispatch(catchUpJob, "catch_up", { missedCount: 4 });
    const manual = await harness.engine.runNow(manualJob.id);

    expect(scheduled).toMatchObject({ trigger: "scheduled", missedCount: 0, status: "success" });
    expect(catchUp).toMatchObject({ trigger: "catch_up", missedCount: 4, status: "success" });
    expect(manual).toMatchObject({ trigger: "manual", missedCount: 0, status: "success" });

    expect(harness.repos.runs.get(scheduled?.id ?? "")?.trigger).toBe("scheduled");
    expect(harness.repos.runs.get(catchUp?.id ?? "")?.missedCount).toBe(4);
    expect(harness.repos.runs.get(manual.id)?.trigger).toBe("manual");
  });
});

describe("engine notifications", () => {
  it("does not notify when the job has notifications disabled", async () => {
    const harness = createHarness();
    const job = createJob(harness.repos, { notify: false, notifyOn: "always" });

    const run = await harness.engine.dispatch(job, "scheduled");

    expect(run?.status).toBe("success");
    expect(run?.notificationDelivered).toBeNull();
    expect(harness.notifier.calls).toHaveLength(0);
  });

  it("does not notify on success when the policy is failure", async () => {
    const harness = createHarness();
    const job = createJob(harness.repos, { notify: true, notifyOn: "failure" });

    const run = await harness.engine.dispatch(job, "scheduled");

    expect(run?.status).toBe("success");
    expect(run?.notificationDelivered).toBeNull();
    expect(harness.notifier.calls).toHaveLength(0);
  });

  it("keeps a failed run when the notifier returns false", async () => {
    const harness = createHarness();
    harness.opencode.handler = () => failureResult("boom");
    harness.notifier.response = async () => false;
    const job = createJob(harness.repos, { notify: true, notifyOn: "failure" });

    const run = await harness.engine.dispatch(job, "scheduled");

    expect(run).toMatchObject({ status: "failed", error: "boom", notificationDelivered: false });
    expect(harness.notifier.calls).toHaveLength(1);
    expect(harness.notifier.calls[0]).toMatchObject({
      jobName: job.name,
      status: "failed",
      durationMs: 7,
      summary: "boom",
      error: "boom",
    });
  });

  it("keeps the run status when the notifier throws", async () => {
    const harness = createHarness();
    harness.opencode.handler = () => failureResult("boom");
    harness.notifier.response = async () => {
      throw new Error("sin bus");
    };
    const job = createJob(harness.repos, { notify: true, notifyOn: "failure" });

    const run = await harness.engine.dispatch(job, "scheduled");

    expect(run).toMatchObject({ status: "failed", notificationDelivered: false });
    expect(harness.notifier.calls).toHaveLength(1);
  });

  it("records a delivered notification on success", async () => {
    const harness = createHarness();
    harness.notifier.response = async () => true;
    const job = createJob(harness.repos, { notify: true, notifyOn: "always" });

    const run = await harness.engine.dispatch(job, "scheduled");

    expect(run).toMatchObject({ status: "success", notificationDelivered: true });
    expect(harness.notifier.calls).toHaveLength(1);
  });
});

describe("engine messages and sessions", () => {
  it("stores the prompt as a user message and the output as an assistant message", async () => {
    const harness = createHarness();
    harness.opencode.handler = () => successResult("la respuesta");
    const job = createJob(harness.repos, { prompt: "el prompt" });

    const run = await harness.engine.dispatch(job, "scheduled");

    expect(harness.repos.messages.listByRun(run?.id ?? "")).toMatchObject([
      { role: "user", content: "el prompt" },
      { role: "assistant", content: "la respuesta" },
    ]);
  });

  it("does not create a user message for a shell run", async () => {
    const harness = createHarness();
    const job = createJob(harness.repos, {
      runner: "shell",
      command: "echo hola",
      prompt: "no debería guardarse",
    });

    const run = await harness.engine.dispatch(job, "scheduled");

    expect(harness.repos.messages.listByRun(run?.id ?? "")).toMatchObject([
      { role: "assistant", content: "salida shell" },
    ]);
  });

  it("persists the session id of a continuous job", async () => {
    const harness = createHarness();
    harness.opencode.handler = () => successResult("ok", "ses_abc");
    const job = createJob(harness.repos, { sessionMode: "continuous" });

    const run = await harness.engine.dispatch(job, "scheduled");

    expect(run?.sessionId).toBe("ses_abc");
    expect(harness.repos.jobs.get(job.id)?.sessionId).toBe("ses_abc");
  });

  it("does not persist the session id on the job in independent mode", async () => {
    const harness = createHarness();
    harness.opencode.handler = () => successResult("ok", "ses_xyz");
    const job = createJob(harness.repos, { sessionMode: "independent" });

    const run = await harness.engine.dispatch(job, "scheduled");

    expect(run?.sessionId).toBe("ses_xyz");
    expect(harness.repos.jobs.get(job.id)?.sessionId).toBeNull();
  });
});

describe("engine manual runs and cancellation", () => {
  it("runs a paused job on demand and reports unknown jobs", async () => {
    const harness = createHarness();
    const job = createJob(harness.repos, { enabled: false });

    const dispatched = await harness.engine.dispatch(job, "scheduled");
    expect(dispatched).toBeNull();
    expect(harness.opencode.calls).toHaveLength(0);

    const run = await harness.engine.runNow(job.id);
    expect(run).toMatchObject({ status: "success", trigger: "manual" });

    await expect(harness.engine.runNow("missing-job")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("cancels the active run and the AI queue", async () => {
    const harness = createHarness({ aiConcurrency: 1 });
    harness.opencode.handler = (_job, signal) =>
      new Promise<RunResult>((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            resolve({
              status: "interrupted",
              exitCode: null,
              output: "",
              error: "aborted",
              sessionId: null,
              durationMs: 0,
            });
          },
          { once: true },
        );
      });

    const firstJob = createJob(harness.repos, { name: "primero" });
    const secondJob = createJob(harness.repos, { name: "segundo" });

    const firstPromise = harness.engine.dispatch(firstJob, "scheduled");
    await until(() => harness.opencode.calls.length === 1);

    const secondPromise = harness.engine.dispatch(secondJob, "scheduled");
    await until(() => {
      const runs = harness.repos.runs.listByJob(secondJob.id, { limit: 10, offset: 0 });
      return runs[0]?.status === "queued";
    });

    await harness.engine.cancelAll();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first).toMatchObject({ status: "interrupted", error: "cancelled" });
    expect(second).toMatchObject({ status: "interrupted", error: "cancelled" });
    expect(harness.opencode.calls).toHaveLength(1);
    expect(harness.repos.jobs.get(firstJob.id)?.lastStatus).toBe("interrupted");
    expect(harness.repos.jobs.get(secondJob.id)?.lastStatus).toBe("interrupted");
  });
});

describe("engine events and failure isolation", () => {
  it("isolates failing listeners and stops delivering after unsubscribe", async () => {
    const harness = createHarness();
    const events: string[] = [];
    const broken = (): void => {
      throw new Error("listener roto");
    };
    const unsubscribeBroken = harness.engine.onEvent(broken);
    const unsubscribe = harness.engine.onEvent((event) => events.push(event.type));
    const job = createJob(harness.repos);

    const first = await harness.engine.dispatch(job, "scheduled");

    expect(first?.status).toBe("success");
    expect(events).toEqual(["run.queued", "run.started", "run.finished"]);

    unsubscribe();
    unsubscribeBroken();
    await harness.engine.dispatch(job, "scheduled");
    expect(events).toHaveLength(3);
  });

  it("does not emit run.queued for shell runs", async () => {
    const harness = createHarness();
    const events: string[] = [];
    harness.engine.onEvent((event) => events.push(event.type));
    const job = createJob(harness.repos, { runner: "shell", command: "true", prompt: null });

    const run = await harness.engine.dispatch(job, "scheduled");

    expect(run?.status).toBe("success");
    expect(events).toEqual(["run.started", "run.finished"]);
  });

  it("persists a runner exception as a failed run", async () => {
    const harness = createHarness();
    harness.opencode.handler = () => {
      throw new Error("runner roto");
    };
    const job = createJob(harness.repos);

    const run = await harness.engine.dispatch(job, "scheduled");

    expect(run).toMatchObject({
      status: "failed",
      exitCode: null,
      output: "",
      error: "runner roto",
      notificationDelivered: null,
    });
  });
});
