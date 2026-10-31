import { homedir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRepositories,
  NotFoundError,
  ValidationError,
  type CreateJobInput,
  type JobRepository,
} from "../../src/db/index.js";
import { cleanupTempDatabases, openTempDatabase } from "./helpers.js";

afterEach(cleanupTempDatabases);

function shellJob(overrides: Partial<CreateJobInput> = {}): CreateJobInput {
  return {
    name: "Copia de seguridad",
    runner: "shell",
    command: "echo hola",
    scheduleKind: "cron",
    scheduleExpr: "0 9 * * *",
    ...overrides,
  };
}

function setup(): JobRepository {
  const { db } = openTempDatabase();
  return createRepositories(db).jobs;
}

function expectValidationError(run: () => unknown, field: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).field).toBe(field);
    return;
  }
  throw new Error(`Se esperaba un ValidationError en el campo ${field}.`);
}

describe("JobRepository", () => {
  it("creates a job with the documented defaults", () => {
    const jobs = setup();
    const before = Date.now();

    const job = jobs.create(shellJob());

    expect(job.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(job.name).toBe("Copia de seguridad");
    expect(job.enabled).toBe(true);
    expect(job.runner).toBe("shell");
    expect(job.prompt).toBeNull();
    expect(job.command).toBe("echo hola");
    expect(job.args).toEqual([]);
    expect(job.cwd).toBe(homedir());
    expect(job.model).toBeNull();
    expect(job.agent).toBeNull();
    expect(job.sessionMode).toBe("independent");
    expect(job.sessionId).toBeNull();
    expect(job.scheduleKind).toBe("cron");
    expect(job.scheduleExpr).toBe("0 9 * * *");
    expect(job.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(job.catchUp).toBe("once");
    expect(job.catchUpLimit).toBe(10);
    expect(job.overlap).toBe("skip");
    expect(job.timeoutSec).toBe(600);
    expect(job.notify).toBe(true);
    expect(job.notifyOn).toBe("always");
    expect(job.nextRunAt).toBeNull();
    expect(job.lastRunAt).toBeNull();
    expect(job.lastStatus).toBeNull();
    expect(job.createdAt).toBeGreaterThanOrEqual(before);
    expect(job.updatedAt).toBe(job.createdAt);

    expect(jobs.get(job.id)).toEqual(job);
  });

  it("persists explicit values and round-trips args", () => {
    const jobs = setup();

    const job = jobs.create({
      name: "Informe",
      enabled: false,
      runner: "opencode",
      prompt: "Resume los cambios",
      command: null,
      args: ["--model", "fast"],
      cwd: "/tmp",
      model: "fast",
      agent: "build",
      sessionMode: "continuous",
      sessionId: "ses_123",
      scheduleKind: "interval",
      scheduleExpr: "15m",
      timezone: "Europe/Madrid",
      catchUp: "all",
      catchUpLimit: 3,
      overlap: "queue",
      timeoutSec: 30,
      notify: false,
      notifyOn: "failure",
    });

    expect(job).toMatchObject({
      name: "Informe",
      enabled: false,
      runner: "opencode",
      prompt: "Resume los cambios",
      command: null,
      args: ["--model", "fast"],
      cwd: "/tmp",
      model: "fast",
      agent: "build",
      sessionMode: "continuous",
      sessionId: "ses_123",
      scheduleKind: "interval",
      scheduleExpr: "15m",
      timezone: "Europe/Madrid",
      catchUp: "all",
      catchUpLimit: 3,
      overlap: "queue",
      timeoutSec: 30,
      notify: false,
      notifyOn: "failure",
    });
    expect(jobs.get(job.id)).toEqual(job);
  });

  it("accepts every schedule kind", () => {
    const jobs = setup();

    const cron = jobs.create(shellJob({ scheduleKind: "cron", scheduleExpr: "*/5 * * * *" }));
    const interval = jobs.create(shellJob({ scheduleKind: "interval", scheduleExpr: "2h" }));
    const once = jobs.create(
      shellJob({ scheduleKind: "once", scheduleExpr: "2030-01-01T10:00:00.000Z" }),
    );
    const ai = jobs.create({
      name: "IA",
      runner: "opencode",
      prompt: "Hola",
      scheduleKind: "cron",
      scheduleExpr: "0 9 * * *",
    });

    expect(cron.scheduleKind).toBe("cron");
    expect(interval.scheduleKind).toBe("interval");
    expect(once.scheduleKind).toBe("once");
    expect(ai.command).toBeNull();
    expect(jobs.list()).toHaveLength(4);
  });

  it("filters by enabled", () => {
    const jobs = setup();
    const active = jobs.create(shellJob({ name: "Activo" }));
    const paused = jobs.create(shellJob({ name: "Pausado", enabled: false }));

    expect(jobs.list()).toHaveLength(2);
    expect(jobs.list({ enabled: true }).map((job) => job.id)).toEqual([active.id]);
    expect(jobs.list({ enabled: false }).map((job) => job.id)).toEqual([paused.id]);
  });

  it("updates a job, validates the merged result and preserves server fields", async () => {
    const jobs = setup();
    const job = jobs.create(
      shellJob({ name: "Original", runner: "opencode", prompt: "Prompt inicial", command: null }),
    );
    jobs.setNextRun(job.id, 999);
    jobs.recordOutcome(job.id, "success", 888);

    await new Promise((resolve) => setTimeout(resolve, 10));
    const updated = jobs.update(job.id, { name: "Renombrado", args: ["-x"] });

    expect(updated.name).toBe("Renombrado");
    expect(updated.args).toEqual(["-x"]);
    expect(updated.nextRunAt).toBe(999);
    expect(updated.lastRunAt).toBe(888);
    expect(updated.lastStatus).toBe("success");
    expect(updated.updatedAt).toBeGreaterThan(job.updatedAt);

    // Switching to shell without a command leaves the merged job invalid.
    expectValidationError(() => jobs.update(job.id, { runner: "shell" }), "command");
    // An opencode job cannot drop its prompt.
    expectValidationError(() => jobs.update(job.id, { prompt: null }), "prompt");
    // Failed updates must leave the stored job untouched.
    expect(jobs.get(job.id)?.runner).toBe("opencode");
    expect(jobs.get(job.id)?.prompt).toBe("Prompt inicial");

    const switched = jobs.update(job.id, { runner: "shell", command: "echo hola" });
    expect(switched.runner).toBe("shell");
    expect(switched.command).toBe("echo hola");
  });

  it("reports a missing job on update", () => {
    const jobs = setup();

    expect(() => jobs.update("missing", { name: "Nada" })).toThrow(NotFoundError);
  });

  it("removes a job", () => {
    const jobs = setup();
    const job = jobs.create(shellJob());

    jobs.remove(job.id);

    expect(jobs.get(job.id)).toBeNull();
    expect(jobs.list()).toEqual([]);
  });

  it("returns due jobs ordered by next run and skipping paused or unscheduled ones", () => {
    const jobs = setup();
    const first = jobs.create(shellJob({ name: "Primero" }));
    const second = jobs.create(shellJob({ name: "Segundo" }));
    const paused = jobs.create(shellJob({ name: "Pausado" }));
    const unscheduled = jobs.create(shellJob({ name: "Sin fecha" }));

    jobs.setNextRun(first.id, 1_000);
    jobs.setNextRun(second.id, 2_000);
    jobs.setNextRun(paused.id, 500);
    jobs.update(paused.id, { enabled: false });

    expect(jobs.dueBefore(1_500).map((job) => job.id)).toEqual([first.id]);
    expect(jobs.dueBefore(2_000).map((job) => job.id)).toEqual([first.id, second.id]);

    jobs.setNextRun(first.id, null);
    expect(jobs.dueBefore(10_000).map((job) => job.id)).toEqual([second.id]);
    expect(unscheduled.nextRunAt).toBeNull();
  });

  it("records the last outcome", () => {
    const jobs = setup();
    const job = jobs.create(shellJob());
    const at = 1_234_567_890;

    jobs.recordOutcome(job.id, "failed", at);

    const recorded = jobs.get(job.id);
    expect(recorded?.lastRunAt).toBe(at);
    expect(recorded?.lastStatus).toBe("failed");
    expect(recorded?.updatedAt).toBe(at);
  });

  it("accepts a 100-character name", () => {
    const jobs = setup();
    const job = jobs.create(shellJob({ name: "x".repeat(100) }));

    expect(job.name).toHaveLength(100);
  });

  describe("validation", () => {
    const invalidCases: Array<{ label: string; input: CreateJobInput; field: string }> = [
      { label: "empty name", input: shellJob({ name: "" }), field: "name" },
      { label: "blank name", input: shellJob({ name: "   " }), field: "name" },
      { label: "name longer than 100", input: shellJob({ name: "x".repeat(101) }), field: "name" },
      {
        label: "opencode without prompt",
        input: shellJob({ runner: "opencode", prompt: null, command: null }),
        field: "prompt",
      },
      {
        label: "shell without command",
        input: shellJob({ command: "   " }),
        field: "command",
      },
      {
        label: "invalid runner",
        input: shellJob({ runner: "python" as unknown as CreateJobInput["runner"] }),
        field: "runner",
      },
      {
        label: "invalid timezone",
        input: shellJob({ timezone: "Marte/Olympus" }),
        field: "timezone",
      },
      {
        label: "catchUpLimit below range",
        input: shellJob({ catchUpLimit: 0 }),
        field: "catchUpLimit",
      },
      {
        label: "catchUpLimit above range",
        input: shellJob({ catchUpLimit: 101 }),
        field: "catchUpLimit",
      },
      {
        label: "non integer catchUpLimit",
        input: shellJob({ catchUpLimit: 1.5 }),
        field: "catchUpLimit",
      },
      { label: "timeoutSec below range", input: shellJob({ timeoutSec: 0 }), field: "timeoutSec" },
      {
        label: "timeoutSec above range",
        input: shellJob({ timeoutSec: 86_401 }),
        field: "timeoutSec",
      },
      {
        label: "cron with four fields",
        input: shellJob({ scheduleExpr: "0 9 * *" }),
        field: "scheduleExpr",
      },
      {
        label: "interval without unit",
        input: shellJob({ scheduleKind: "interval", scheduleExpr: "15" }),
        field: "scheduleExpr",
      },
      {
        label: "non ISO once date",
        input: shellJob({ scheduleKind: "once", scheduleExpr: "mañana" }),
        field: "scheduleExpr",
      },
      {
        label: "invalid schedule kind",
        input: shellJob({
          scheduleKind: "weekly" as unknown as CreateJobInput["scheduleKind"],
        }),
        field: "scheduleKind",
      },
      {
        label: "args with a non string",
        input: shellJob({ args: ["ok", 3 as unknown as string] }),
        field: "args",
      },
      { label: "blank cwd", input: shellJob({ cwd: "   " }), field: "cwd" },
      {
        label: "invalid catchUp",
        input: shellJob({ catchUp: "sometimes" as unknown as CreateJobInput["catchUp"] }),
        field: "catchUp",
      },
      {
        label: "invalid overlap",
        input: shellJob({ overlap: "explode" as unknown as CreateJobInput["overlap"] }),
        field: "overlap",
      },
      {
        label: "invalid notifyOn",
        input: shellJob({ notifyOn: "never" as unknown as CreateJobInput["notifyOn"] }),
        field: "notifyOn",
      },
    ];

    it.each(invalidCases)("rejects $label", ({ input, field }) => {
      const jobs = setup();

      expectValidationError(() => jobs.create(input), field);
      expect(jobs.list()).toEqual([]);
    });
  });
});
