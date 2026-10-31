import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Job, JobUsage, Run, RunUsage } from "@laicron/core";

import { readJson, request, startTestApi, stopTestApi, type TestApi } from "./helpers.js";

interface JobResponse {
  job: Job;
}

interface UsageResponse {
  usage: JobUsage;
}

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    field?: string;
  };
}

const JOB_INPUT = {
  name: "Cron con consumo",
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

async function createJob(): Promise<Job> {
  const response = await request(api, "/api/jobs", {
    method: "POST",
    body: JSON.stringify(JOB_INPUT),
  });
  expect(response.status).toBe(201);
  return (await readJson<JobResponse>(response)).job;
}

/** Creates a started run and finishes it with the given consumption. */
function finishRun(jobId: string, usage: RunUsage | null): Run {
  const created = api.repos.runs.create({ jobId, trigger: "scheduled", status: "queued" });
  const run = api.repos.runs.markStarted(created.id, 1_000);
  return api.repos.runs.finish(run.id, {
    status: "success",
    finishedAt: 2_000,
    durationMs: 1_000,
    exitCode: 0,
    output: "ok",
    error: null,
    sessionId: null,
    notificationDelivered: null,
    usage,
  });
}

describe("GET /api/jobs/:id/usage", () => {
  it("aggregates every run, ignoring the ones without data", async () => {
    const job = await createJob();

    finishRun(job.id, {
      inputTokens: 1_000,
      outputTokens: 200,
      reasoningTokens: 50,
      cacheReadTokens: 100,
      cacheWriteTokens: 20,
      costUsd: 0.5,
    });

    // Simulates a source that reported tokens but no cost or reasoning data.
    const tokensOnly = finishRun(job.id, null);
    api.db
      .prepare("UPDATE runs SET input_tokens = ?, output_tokens = ? WHERE id = ?")
      .run(300, 40, tokensOnly.id);

    finishRun(job.id, null);

    const response = await request(api, `/api/jobs/${job.id}/usage`);
    expect(response.status).toBe(200);
    expect(await readJson<UsageResponse>(response)).toEqual({
      usage: {
        runs: 3,
        runsWithUsage: 2,
        inputTokens: 1_300,
        outputTokens: 240,
        reasoningTokens: 50,
        cacheReadTokens: 100,
        cacheWriteTokens: 20,
        costUsd: 0.5,
      },
    });
  });

  it("returns zeroed totals for a job without runs", async () => {
    const job = await createJob();

    const response = await request(api, `/api/jobs/${job.id}/usage`);
    expect(response.status).toBe(200);
    expect(await readJson<UsageResponse>(response)).toEqual({
      usage: {
        runs: 0,
        runsWithUsage: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
      },
    });
  });

  it("returns 404 for an unknown job", async () => {
    const response = await request(api, "/api/jobs/no-such-job/usage");
    expect(response.status).toBe(404);
    expect((await readJson<ErrorResponse>(response)).error.code).toBe("not_found");
  });

  it("requires the API token", async () => {
    const job = await createJob();

    const response = await request(api, `/api/jobs/${job.id}/usage`, {}, null);
    expect(response.status).toBe(401);
    expect((await readJson<ErrorResponse>(response)).error.code).toBe("unauthorized");
  });
});
