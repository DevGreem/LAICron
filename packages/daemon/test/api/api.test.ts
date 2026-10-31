import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Job, Message, Run } from "@laicron/core";

import {
  TEST_VERSION,
  readJson,
  readUntil,
  request,
  startTestApi,
  stopTestApi,
  type TestApi,
} from "./helpers.js";

interface JobResponse {
  job: Job;
}

interface JobsResponse {
  jobs: Job[];
}

interface RunResponse {
  run: Run;
}

interface RunsResponse {
  runs: Run[];
  total: number;
  limit: number;
  offset: number;
}

interface MessagesResponse {
  messages: Message[];
  total: number;
  limit: number;
  offset: number;
}

interface HealthResponse {
  status: string;
  version: string;
  uptimeMs: number;
  heartbeatAt: number | null;
}

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    field?: string;
  };
}

const JOB_INPUT = {
  name: "Cron de prueba",
  runner: "shell",
  command: "echo hola",
  scheduleKind: "interval",
  scheduleExpr: "15m",
} as const;

let api: TestApi;

beforeEach(async () => {
  api = await startTestApi();
});

afterEach(async () => {
  await stopTestApi(api);
});

async function createJob(overrides: Record<string, unknown> = {}): Promise<Job> {
  const response = await request(api, "/api/jobs", {
    method: "POST",
    body: JSON.stringify({ ...JOB_INPUT, ...overrides }),
  });
  expect(response.status).toBe(201);
  return (await readJson<JobResponse>(response)).job;
}

describe("authentication", () => {
  it("rejects requests without a token or with a wrong token", async () => {
    const missing = await request(api, "/api/jobs", {}, null);
    expect(missing.status).toBe(401);
    expect((await readJson<ErrorResponse>(missing)).error.code).toBe("unauthorized");

    const wrong = await request(api, "/api/jobs", {}, "b".repeat(64));
    expect(wrong.status).toBe(401);
    expect((await readJson<ErrorResponse>(wrong)).error.code).toBe("unauthorized");

    const valid = await request(api, "/api/jobs");
    expect(valid.status).toBe(200);
    expect((await readJson<JobsResponse>(valid)).jobs).toEqual([]);
  });
});

describe("GET /api/health", () => {
  it("is public and reports the heartbeat as null when absent", async () => {
    const response = await request(api, "/api/health", {}, null);

    expect(response.status).toBe(200);
    const body = await readJson<HealthResponse>(response);
    expect(body.status).toBe("ok");
    expect(body.version).toBe(TEST_VERSION);
    expect(typeof body.uptimeMs).toBe("number");
    expect(body.heartbeatAt).toBeNull();
  });

  it("returns the stored heartbeat as a number", async () => {
    api.repos.meta.set("heartbeat_at", "1700000000123");

    const response = await request(api, "/api/health", {}, null);

    expect(response.status).toBe(200);
    expect((await readJson<HealthResponse>(response)).heartbeatAt).toBe(1700000000123);
  });
});

describe("job CRUD", () => {
  it("creates, lists, updates and deletes a job", async () => {
    const created = await createJob();
    expect(created.id.length).toBeGreaterThan(0);
    expect(created.name).toBe(JOB_INPUT.name);
    expect(created.nextRunAt).toBe(api.now() + 15 * 60_000);

    const list = await request(api, "/api/jobs");
    expect(list.status).toBe(200);
    expect((await readJson<JobsResponse>(list)).jobs.map((job) => job.id)).toEqual([created.id]);

    const patched = await request(api, `/api/jobs/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Renombrado" }),
    });
    expect(patched.status).toBe(200);
    expect((await readJson<JobResponse>(patched)).job.name).toBe("Renombrado");

    const deleted = await request(api, `/api/jobs/${created.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");

    const gone = await request(api, `/api/jobs/${created.id}`);
    expect(gone.status).toBe(404);
  });
});

describe("validation", () => {
  it("recomputes nextRunAt when the schedule changes", async () => {
    const created = await createJob();

    const patched = await request(api, `/api/jobs/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ scheduleKind: "cron", scheduleExpr: "0 9 * * *" }),
    });

    expect(patched.status).toBe(200);
    const job = (await readJson<JobResponse>(patched)).job;
    expect(job.scheduleKind).toBe("cron");
    expect(job.scheduleExpr).toBe("0 9 * * *");
    expect(job.nextRunAt).not.toBeNull();
    expect(job.nextRunAt).not.toBe(created.nextRunAt);
  });

  it("rejects an invalid schedule on update and keeps the previous one", async () => {
    const created = await createJob();

    const patched = await request(api, `/api/jobs/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ scheduleExpr: "not a cron" }),
    });

    expect(patched.status).toBe(400);
    expect((await readJson<ErrorResponse>(patched)).error.field).toBe("scheduleExpr");

    const stored = await request(api, `/api/jobs/${created.id}`);
    expect((await readJson<JobResponse>(stored)).job.scheduleExpr).toBe(JOB_INPUT.scheduleExpr);
  });

  it("rejects an invalid cron expression and points at scheduleExpr", async () => {
    const response = await request(api, "/api/jobs", {
      method: "POST",
      body: JSON.stringify({
        ...JOB_INPUT,
        scheduleKind: "cron",
        scheduleExpr: "61 * * * *",
      }),
    });

    expect(response.status).toBe(400);
    const body = await readJson<ErrorResponse>(response);
    expect(body.error.code).toBe("validation_error");
    expect(body.error.field).toBe("scheduleExpr");

    const list = await request(api, "/api/jobs");
    expect((await readJson<JobsResponse>(list)).jobs).toEqual([]);
  });

  it("rejects an empty name and points at name", async () => {
    const response = await request(api, "/api/jobs", {
      method: "POST",
      body: JSON.stringify({ ...JOB_INPUT, name: "   " }),
    });

    expect(response.status).toBe(400);
    const body = await readJson<ErrorResponse>(response);
    expect(body.error.code).toBe("validation_error");
    expect(body.error.field).toBe("name");
  });

  it("rejects malformed JSON", async () => {
    const response = await request(api, "/api/jobs", {
      method: "POST",
      body: "{not json",
    });

    expect(response.status).toBe(400);
    expect((await readJson<ErrorResponse>(response)).error.code).toBe("validation_error");
  });
});

describe("pause and resume", () => {
  it("clears nextRunAt when paused and recomputes it from now when resumed", async () => {
    const created = await createJob();

    const paused = await request(api, `/api/jobs/${created.id}/pause`, { method: "POST" });
    expect(paused.status).toBe(200);
    const pausedJob = (await readJson<JobResponse>(paused)).job;
    expect(pausedJob.enabled).toBe(false);
    expect(pausedJob.nextRunAt).toBeNull();

    api.setNow(api.now() + 60_000);

    const resumed = await request(api, `/api/jobs/${created.id}/resume`, { method: "POST" });
    expect(resumed.status).toBe(200);
    const resumedJob = (await readJson<JobResponse>(resumed)).job;
    expect(resumedJob.enabled).toBe(true);
    expect(resumedJob.nextRunAt).toBe(api.now() + 15 * 60_000);
  });
});

describe("POST /api/jobs/:id/run", () => {
  it("answers 202 and asks the engine to run the job", async () => {
    const created = await createJob();

    const response = await request(api, `/api/jobs/${created.id}/run`, { method: "POST" });

    expect(response.status).toBe(202);
    const body = await readJson<RunResponse>(response);
    expect(body.run.jobId).toBe(created.id);
    expect(body.run.trigger).toBe("manual");
    expect(api.engine.runNowCalls).toEqual([created.id]);
  });
});

describe("history pagination", () => {
  it("returns different pages with the correct total for runs", async () => {
    const job = await createJob();
    for (let index = 0; index < 5; index += 1) {
      api.repos.runs.create({ jobId: job.id, trigger: "scheduled", status: "success" });
    }

    const first = await request(api, `/api/jobs/${job.id}/runs?limit=2&offset=0`);
    expect(first.status).toBe(200);
    const firstPage = await readJson<RunsResponse>(first);
    expect(firstPage.total).toBe(5);
    expect(firstPage.limit).toBe(2);
    expect(firstPage.offset).toBe(0);
    expect(firstPage.runs).toHaveLength(2);

    const second = await request(api, `/api/jobs/${job.id}/runs?limit=2&offset=2`);
    const secondPage = await readJson<RunsResponse>(second);
    expect(secondPage.total).toBe(5);
    expect(secondPage.offset).toBe(2);
    expect(secondPage.runs).toHaveLength(2);

    const firstIds = firstPage.runs.map((run) => run.id);
    const secondIds = secondPage.runs.map((run) => run.id);
    expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);

    const invalid = await request(api, `/api/jobs/${job.id}/runs?limit=0`);
    expect(invalid.status).toBe(400);
    expect((await readJson<ErrorResponse>(invalid)).error.field).toBe("limit");
  });

  it("returns different pages with the correct total for messages", async () => {
    const job = await createJob();
    const run = api.repos.runs.create({ jobId: job.id, trigger: "manual", status: "success" });
    for (let index = 0; index < 3; index += 1) {
      api.repos.messages.create({
        jobId: job.id,
        runId: run.id,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `mensaje ${index}`,
        createdAt: api.now() + index,
      });
    }

    const first = await request(api, `/api/jobs/${job.id}/messages?limit=2&offset=0`);
    expect(first.status).toBe(200);
    const firstPage = await readJson<MessagesResponse>(first);
    expect(firstPage.total).toBe(3);
    expect(firstPage.limit).toBe(2);
    expect(firstPage.messages.map((message) => message.content)).toEqual([
      "mensaje 0",
      "mensaje 1",
    ]);

    const second = await request(api, `/api/jobs/${job.id}/messages?limit=2&offset=2`);
    const secondPage = await readJson<MessagesResponse>(second);
    expect(secondPage.total).toBe(3);
    expect(secondPage.offset).toBe(2);
    expect(secondPage.messages.map((message) => message.content)).toEqual(["mensaje 2"]);
  });
});

describe("SSE events", () => {
  it("streams run.finished with the event data", async () => {
    const job = await createJob();
    const run = api.repos.runs.create({
      jobId: job.id,
      trigger: "scheduled",
      status: "success",
    });

    const controller = new AbortController();
    const response = await request(api, "/api/events", { signal: controller.signal });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("connection")).toBe("keep-alive");

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (reader === undefined) {
      controller.abort();
      return;
    }

    // Wait for the opening comment before emitting, so the client is registered.
    await readUntil(reader, (text) => text.includes(": connected"));

    api.engine.emit({ type: "run.finished", run });

    const received = await readUntil(reader, (text) => text.includes("event: run.finished"));
    expect(received).toContain("event: run.finished");
    expect(received).toContain('"type":"run.finished"');
    expect(received).toContain(run.id);

    controller.abort();
  });

  it("closes open SSE streams when the server stops", async () => {
    const controller = new AbortController();
    const response = await request(api, "/api/events", { signal: controller.signal });
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (reader === undefined) {
      controller.abort();
      return;
    }

    await readUntil(reader, (text) => text.includes(": connected"));

    await expect(api.api.stop()).resolves.toBeUndefined();
    controller.abort();
  });
});

describe("static UI", () => {
  it("serves index.html and assets without a token", async () => {
    const index = await request(api, "/", {}, null);
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toContain("text/html");
    expect(await index.text()).toContain("LAICron UI");

    const script = await request(api, "/app.js", {}, null);
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("text/javascript");
  });

  it("does not escape uiRoot with traversal paths", async () => {
    const plain = await request(api, "/../etc/passwd", {}, null);
    expect(plain.status).toBe(404);

    const encoded = await request(api, "/..%2F..%2Fetc%2Fpasswd", {}, null);
    expect(encoded.status).toBe(404);
    expect((await readJson<ErrorResponse>(encoded)).error.code).toBe("not_found");
  });
});

describe("unknown jobs", () => {
  it("returns 404 for every job-scoped route", async () => {
    const missingId = "no-such-job";

    const get = await request(api, `/api/jobs/${missingId}`);
    expect(get.status).toBe(404);
    expect((await readJson<ErrorResponse>(get)).error.code).toBe("not_found");

    const patch = await request(api, `/api/jobs/${missingId}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Nuevo" }),
    });
    expect(patch.status).toBe(404);

    const remove = await request(api, `/api/jobs/${missingId}`, { method: "DELETE" });
    expect(remove.status).toBe(404);

    const pause = await request(api, `/api/jobs/${missingId}/pause`, { method: "POST" });
    expect(pause.status).toBe(404);

    const resume = await request(api, `/api/jobs/${missingId}/resume`, { method: "POST" });
    expect(resume.status).toBe(404);

    const run = await request(api, `/api/jobs/${missingId}/run`, { method: "POST" });
    expect(run.status).toBe(404);

    const runs = await request(api, `/api/jobs/${missingId}/runs`);
    expect(runs.status).toBe(404);

    const messages = await request(api, `/api/jobs/${missingId}/messages`);
    expect(messages.status).toBe(404);
  });
});
