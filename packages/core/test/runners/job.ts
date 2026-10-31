import type { Job } from "../../src/types.js";

export function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-test",
    name: "test job",
    enabled: true,
    runner: "shell",
    prompt: null,
    command: null,
    args: [],
    cwd: process.cwd(),
    model: null,
    agent: null,
    sessionMode: "independent",
    sessionId: null,
    scheduleKind: "once",
    scheduleExpr: "",
    timezone: "UTC",
    catchUp: "none",
    catchUpLimit: 1,
    overlap: "skip",
    timeoutSec: 10,
    notify: false,
    notifyOn: "failure",
    nextRunAt: null,
    lastRunAt: null,
    lastStatus: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}
