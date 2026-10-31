import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Engine, EngineEvent, Job, Run, RunTrigger } from "@laicron/core";
import {
  closeDatabase,
  createRepositories,
  openDatabase,
  type Database,
  type Repositories,
} from "@laicron/core/db";

import { createApiServer, type ApiDeps, type ApiServer } from "../../src/api/index.js";

export const TEST_TOKEN = "a".repeat(64);
export const TEST_VERSION = "9.9.9-test";

/** Engine double that records calls and lets tests emit arbitrary events. */
export class FakeEngine implements Engine {
  readonly runNowCalls: string[] = [];
  readonly dispatchCalls: Array<{ jobId: string; trigger: RunTrigger }> = [];

  private readonly listeners = new Set<(event: EngineEvent) => void>();
  private readonly runs: Repositories["runs"];

  constructor(runs: Repositories["runs"]) {
    this.runs = runs;
  }

  async dispatch(job: Job, trigger: RunTrigger): Promise<Run | null> {
    this.dispatchCalls.push({ jobId: job.id, trigger });
    return null;
  }

  async runNow(jobId: string): Promise<Run> {
    this.runNowCalls.push(jobId);
    return this.runs.create({ jobId, trigger: "manual", status: "queued" });
  }

  async cancelAll(): Promise<void> {
    // Nothing to cancel in the double.
  }

  onEvent(listener: (event: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: EngineEvent): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }
}

export interface TestApi {
  api: ApiServer;
  base: string;
  deps: ApiDeps;
  engine: FakeEngine;
  repos: Repositories;
  db: Database;
  directory: string;
  uiRoot: string;
  now: () => number;
  setNow: (value: number) => void;
}

/** Starts the API on an ephemeral port against real repositories and a temp UI. */
export async function startTestApi(): Promise<TestApi> {
  const directory = mkdtempSync(join(tmpdir(), "laicron-api-"));
  const db = openDatabase(join(directory, "laicron.db"));
  const repos = createRepositories(db);

  const uiRoot = join(directory, "ui");
  mkdirSync(uiRoot, { recursive: true });
  writeFileSync(
    join(uiRoot, "index.html"),
    "<!doctype html><html><body><h1>LAICron UI</h1></body></html>",
  );
  writeFileSync(join(uiRoot, "app.js"), "console.log('laicron');\n");

  let currentNow = 1_700_000_000_000;
  const now = (): number => currentNow;
  const engine = new FakeEngine(repos.runs);

  const deps: ApiDeps = {
    engine,
    jobs: repos.jobs,
    runs: repos.runs,
    messages: repos.messages,
    meta: repos.meta,
    token: TEST_TOKEN,
    now,
    uiRoot,
    version: TEST_VERSION,
  };

  const api = createApiServer(deps);
  const port = await api.start(0);

  return {
    api,
    base: `http://127.0.0.1:${port}`,
    deps,
    engine,
    repos,
    db,
    directory,
    uiRoot,
    now,
    setNow: (value: number) => {
      currentNow = value;
    },
  };
}

export async function stopTestApi(api: TestApi): Promise<void> {
  await api.api.stop();
  closeDatabase(api.db);
  rmSync(api.directory, { recursive: true, force: true });
}

/** Authenticated fetch helper; pass `token: null` to omit the header. */
export function request(
  api: TestApi,
  path: string,
  init: RequestInit = {},
  token: string | null = TEST_TOKEN,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token !== null) {
    headers.set("authorization", `Bearer ${token}`);
  }
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return fetch(`${api.base}${path}`, { ...init, headers });
}

export async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("SSE read timeout")), timeoutMs);
    reader.read().then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Reads an SSE stream until `predicate` matches the accumulated text. */
export async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (text: string) => boolean,
  timeoutMs = 5000,
): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + timeoutMs;

  while (!predicate(buffer)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`SSE timeout. Received so far: ${buffer}`);
    }
    const result = await readWithTimeout(reader, remaining);
    if (result.done) {
      break;
    }
    buffer += decoder.decode(result.value, { stream: true });
  }

  return buffer;
}
