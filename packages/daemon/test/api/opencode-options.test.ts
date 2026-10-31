import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { closeDatabase, createRepositories, openDatabase, type Database } from "@laicron/core/db";

import { createApiServer, type ApiDeps, type ApiServer } from "../../src/api/index.js";
import type { OpencodeOptions, OpencodeOptionsService } from "../../src/opencode-options.js";
import { FakeEngine, TEST_TOKEN, TEST_VERSION } from "./helpers.js";

const CATALOG: OpencodeOptions = {
  available: true,
  reason: null,
  models: [
    {
      id: "opencode/deepseek-v4.1-flash",
      provider: "opencode",
      name: "DeepSeek V4.1 Flash",
      variants: ["low", "high"],
    },
  ],
  agents: [{ id: "build", name: "Build", description: "The default agent", mode: "all" }],
};

class FakeOpencodeOptions implements OpencodeOptionsService {
  readonly calls: boolean[] = [];

  private readonly value: OpencodeOptions;

  constructor(value: OpencodeOptions) {
    this.value = value;
  }

  async get(refresh = false): Promise<OpencodeOptions> {
    this.calls.push(refresh);
    return this.value;
  }
}

interface TestServer {
  api: ApiServer;
  base: string;
  db: Database;
  directory: string;
}

const servers: TestServer[] = [];

async function startApi(options: OpencodeOptionsService): Promise<TestServer> {
  const directory = mkdtempSync(join(tmpdir(), "laicron-opencode-api-"));
  const db = openDatabase(join(directory, "laicron.db"));
  const repos = createRepositories(db);

  const uiRoot = join(directory, "ui");
  mkdirSync(uiRoot, { recursive: true });
  writeFileSync(join(uiRoot, "index.html"), "<!doctype html><html><body></body></html>");

  const deps: ApiDeps = {
    engine: new FakeEngine(repos.runs),
    jobs: repos.jobs,
    runs: repos.runs,
    messages: repos.messages,
    meta: repos.meta,
    token: TEST_TOKEN,
    now: () => 1_700_000_000_000,
    uiRoot,
    version: TEST_VERSION,
    opencodeOptions: options,
  };

  const api = createApiServer(deps);
  const port = await api.start(0);
  const server: TestServer = { api, base: `http://127.0.0.1:${port}`, db, directory };
  servers.push(server);
  return server;
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.api.stop();
    closeDatabase(server.db);
    rmSync(server.directory, { recursive: true, force: true });
  }
});

function getOptions(
  server: TestServer,
  query = "",
  token: string | null = TEST_TOKEN,
): Promise<Response> {
  const headers = new Headers();
  if (token !== null) {
    headers.set("authorization", `Bearer ${token}`);
  }
  return fetch(`${server.base}/api/opencode/options${query}`, { headers });
}

describe("GET /api/opencode/options", () => {
  it("requires the API token and returns the catalog with it", async () => {
    const options = new FakeOpencodeOptions(CATALOG);
    const server = await startApi(options);

    const unauthorized = await getOptions(server, "", null);
    expect(unauthorized.status).toBe(401);
    expect(options.calls).toEqual([]);

    const response = await getOptions(server);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(CATALOG);
    expect(options.calls).toEqual([false]);
  });

  it("refreshes the catalog when refresh=1", async () => {
    const options = new FakeOpencodeOptions(CATALOG);
    const server = await startApi(options);

    expect((await getOptions(server, "?refresh=1")).status).toBe(200);
    expect((await getOptions(server, "?refresh=true")).status).toBe(200);
    expect((await getOptions(server, "?refresh=0")).status).toBe(200);

    expect(options.calls).toEqual([true, true, false]);
  });

  it("returns 200 with an unavailable catalog", async () => {
    const unavailable: OpencodeOptions = {
      available: false,
      reason: "opencode no está instalado o no está en el PATH",
      models: [],
      agents: [],
    };
    const server = await startApi(new FakeOpencodeOptions(unavailable));

    const response = await getOptions(server);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(unavailable);
  });
});
