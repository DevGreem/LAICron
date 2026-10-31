import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { createMcpLister, type McpLister, type OpencodeMcpOption } from "@laicron/core/runners";
import { afterEach, describe, expect, it } from "vitest";

import {
  createOpencodeOptions,
  type ExecFn,
  type ExecResult,
  type OpencodeOptionsService,
} from "../src/opencode-options.js";

const directories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "laicron-opencode-"));
  directories.push(directory);
  return directory;
}

function writeCache(contents: unknown): string {
  const path = join(temporaryDirectory(), "models.json");
  writeFileSync(path, typeof contents === "string" ? contents : JSON.stringify(contents));
  return path;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

interface ExecCall {
  cmd: string;
  args: string[];
}

interface FakeExecResult {
  exec: ExecFn;
  calls: ExecCall[];
}

interface FakeExecResults {
  models?: ExecResult;
  agents?: ExecResult;
  mcps?: ExecResult;
}

const EMPTY_AGENTS: ExecResult = { code: 0, stdout: "[]", stderr: "" };

const MCP_LIST: ExecResult = {
  code: 0,
  stdout: "✓ github connected\n○ xerj disabled\n✗ roto failed: boom\n",
  stderr: "",
};

const MCP_OPTIONS: OpencodeMcpOption[] = [
  { name: "github", enabled: true, status: "connected" },
  { name: "xerj", enabled: false, status: "disabled" },
  { name: "roto", enabled: true, status: "failed: boom" },
];

function fakeExec(results: FakeExecResults): FakeExecResult {
  const calls: ExecCall[] = [];
  const exec: ExecFn = async (cmd, args) => {
    calls.push({ cmd, args });
    if (args[0] === "models") {
      return results.models ?? { code: 1, stdout: "", stderr: "unexpected command" };
    }
    if (args[0] === "mcp") {
      return results.mcps ?? MCP_LIST;
    }
    return results.agents ?? { code: 1, stdout: "", stderr: "unexpected command" };
  };
  return { exec, calls };
}

/** Feeds the fake exec into the real lister so the service wiring is covered. */
function mcpListerFromExec(exec: ExecFn): McpLister {
  return createMcpLister({ exec: async (cmd, args) => exec(cmd, args) });
}

interface ServiceOptions {
  exec: ExecFn;
  modelsCachePath: string;
  mcpLister?: McpLister;
  now?: () => number;
  ttlMs?: number;
}

/** Builds the service with an isolated MCP lister so no real process runs. */
function createService(options: ServiceOptions): OpencodeOptionsService {
  return createOpencodeOptions({
    exec: options.exec,
    modelsCachePath: options.modelsCachePath,
    mcpLister: options.mcpLister ?? mcpListerFromExec(options.exec),
    now: options.now,
    ttlMs: options.ttlMs,
  });
}

interface McpCall {
  cwd: string;
  refresh: boolean;
}

interface SpyMcpLister {
  calls: McpCall[];
  lister: McpLister;
}

function spyMcpLister(
  options: OpencodeMcpOption[] = [],
  failure: Error | null = null,
): SpyMcpLister {
  const calls: McpCall[] = [];
  const lister: McpLister = {
    async list(cwd, refresh = false) {
      calls.push({ cwd, refresh });
      if (failure !== null) {
        throw failure;
      }
      return options.map((option) => ({ ...option }));
    },
  };
  return { calls, lister };
}

function countModelsCalls(calls: ExecCall[]): number {
  return calls.filter((call) => call.args[0] === "models").length;
}

describe("createOpencodeOptions", () => {
  it("reads model names and variants from the opencode cache", async () => {
    const cachePath = writeCache({
      opencode: {
        models: {
          "deepseek-v4.1-flash": {
            name: "DeepSeek V4.1 Flash",
            reasoning_options: [
              { type: "effort", values: ["low", "high", "max"] },
              { type: "effort", values: ["high", "medium"] },
            ],
          },
        },
      },
    });
    const { exec } = fakeExec({
      models: { code: 0, stdout: "opencode/deepseek-v4.1-flash\n", stderr: "" },
      agents: EMPTY_AGENTS,
    });

    const options = await createService({ exec, modelsCachePath: cachePath }).get();

    expect(options.available).toBe(true);
    expect(options.reason).toBeNull();
    expect(options.models).toEqual([
      {
        id: "opencode/deepseek-v4.1-flash",
        provider: "opencode",
        name: "DeepSeek V4.1 Flash",
        variants: ["low", "high", "max", "medium"],
      },
    ]);
  });

  it("keeps only visible primary agents and strips private fields", async () => {
    const cachePath = writeCache("{}");
    const agents = [
      {
        id: "build",
        name: "Build",
        description: "The default agent",
        mode: "all",
        hidden: false,
        system: "TOP SECRET PROMPT",
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
        request: { settings: {}, headers: {}, body: {} },
      },
      {
        id: "plan",
        name: "Plan",
        description: "Plans the work",
        mode: "primary",
        hidden: false,
        system: "ANOTHER SECRET",
      },
      {
        id: "explore",
        name: "Explore",
        description: "Subagent",
        mode: "subagent",
        hidden: false,
        system: "SUBAGENT SECRET",
      },
      {
        id: "compaction",
        name: "Compaction",
        description: "Hidden primary",
        mode: "primary",
        hidden: true,
        system: "HIDDEN SECRET",
      },
    ];
    const { exec } = fakeExec({
      models: { code: 0, stdout: "opencode/model-a\n", stderr: "" },
      agents: { code: 0, stdout: JSON.stringify(agents), stderr: "" },
    });

    const options = await createService({ exec, modelsCachePath: cachePath }).get();

    expect(options.agents).toEqual([
      { id: "build", name: "Build", description: "The default agent", mode: "all" },
      { id: "plan", name: "Plan", description: "Plans the work", mode: "primary" },
    ]);

    const serialized = JSON.stringify(options);
    expect(serialized).not.toContain("system");
    expect(serialized).not.toContain("TOP SECRET PROMPT");
    expect(serialized).not.toContain("permissions");
    expect(serialized).not.toContain("request");
  });

  it("lists MCP servers with their enabled state", async () => {
    const cachePath = writeCache("{}");
    const { exec } = fakeExec({
      models: { code: 0, stdout: "opencode/model-a\n", stderr: "" },
      agents: EMPTY_AGENTS,
      mcps: MCP_LIST,
    });

    const options = await createService({ exec, modelsCachePath: cachePath }).get();

    expect(options.mcps).toEqual(MCP_OPTIONS);
  });

  it("caches MCPs per working directory and reuses the same cwd", async () => {
    const cachePath = writeCache("{}");
    const { exec } = fakeExec({
      models: { code: 0, stdout: "opencode/model-a\n", stderr: "" },
      agents: EMPTY_AGENTS,
    });
    const { lister, calls } = spyMcpLister(MCP_OPTIONS);
    const service = createService({
      exec,
      modelsCachePath: cachePath,
      mcpLister: lister,
      now: () => 1_000,
      ttlMs: 60_000,
    });

    await service.get(false, "/tmp/a");
    await service.get(false, "/tmp/a");
    expect(calls).toEqual([{ cwd: "/tmp/a", refresh: false }]);

    await service.get(false, "/tmp/b");
    expect(calls.map((call) => call.cwd)).toEqual(["/tmp/a", "/tmp/b"]);
  });

  it("uses the home directory when cwd is omitted", async () => {
    const cachePath = writeCache("{}");
    const { exec } = fakeExec({
      models: { code: 0, stdout: "opencode/model-a\n", stderr: "" },
      agents: EMPTY_AGENTS,
    });
    const { lister, calls } = spyMcpLister(MCP_OPTIONS);
    const service = createService({ exec, modelsCachePath: cachePath, mcpLister: lister });

    await service.get(false);

    expect(calls).toEqual([{ cwd: homedir(), refresh: false }]);
  });

  it("refreshes MCPs and models on demand", async () => {
    const cachePath = writeCache("{}");
    const { exec, calls } = fakeExec({
      models: { code: 0, stdout: "opencode/model-a\n", stderr: "" },
      agents: EMPTY_AGENTS,
    });
    const { lister, calls: mcpCalls } = spyMcpLister(MCP_OPTIONS);
    const service = createService({ exec, modelsCachePath: cachePath, mcpLister: lister });

    await service.get(false);
    await service.get(false);
    expect(mcpCalls).toHaveLength(1);
    expect(countModelsCalls(calls)).toBe(1);

    await service.get(true);
    expect(mcpCalls).toHaveLength(2);
    expect(mcpCalls[1]).toEqual({ cwd: homedir(), refresh: true });
    expect(countModelsCalls(calls)).toBe(2);
  });

  it("keeps models and agents when the MCP listing fails", async () => {
    const cachePath = writeCache("{}");
    const { exec } = fakeExec({
      models: { code: 0, stdout: "opencode/model-a\n", stderr: "" },
      agents: EMPTY_AGENTS,
    });
    const { lister } = spyMcpLister([], new Error("boom"));

    const options = await createService({
      exec,
      modelsCachePath: cachePath,
      mcpLister: lister,
    }).get();

    expect(options.available).toBe(true);
    expect(options.models.map((model) => model.id)).toEqual(["opencode/model-a"]);
    expect(options.mcps).toEqual([]);
  });

  it("returns an unavailable catalog when opencode models fails", async () => {
    const cachePath = writeCache("{}");
    const { exec } = fakeExec({ models: { code: 1, stdout: "", stderr: "boom" } });

    const service = createService({ exec, modelsCachePath: cachePath });
    const options = await service.get();

    expect(options).toMatchObject({ available: false, models: [], agents: [] });
    expect(options.reason).not.toBeNull();
    expect(options.reason).toContain("opencode");
    // MCPs do not depend on the models command, so they are still reported.
    expect(options.mcps).toEqual(MCP_OPTIONS);
  });

  it("explains when the opencode binary is missing", async () => {
    const cachePath = writeCache("{}");
    const { exec } = fakeExec({ models: { code: 127, stdout: "", stderr: "ENOENT" } });

    const options = await createService({ exec, modelsCachePath: cachePath }).get();

    expect(options.available).toBe(false);
    expect(options.reason).toContain("no está instalado");
    expect(options.models).toEqual([]);
    expect(options.agents).toEqual([]);
  });

  it("keeps models when the agent listing fails", async () => {
    const cachePath = writeCache("{}");
    const { exec } = fakeExec({
      models: { code: 0, stdout: "opencode/model-a\n", stderr: "" },
      agents: { code: 1, stdout: "", stderr: "boom" },
    });

    const options = await createService({ exec, modelsCachePath: cachePath }).get();

    expect(options.available).toBe(true);
    expect(options.models.map((model) => model.id)).toEqual(["opencode/model-a"]);
    expect(options.agents).toEqual([]);
  });

  it("falls back to the raw id when the models cache is missing", async () => {
    const cachePath = join(temporaryDirectory(), "absent.json");
    const { exec } = fakeExec({
      models: {
        code: 0,
        stdout: "opencode/model-a\n\n  \ninvalid-line\nanthropic/claude-x\n",
        stderr: "",
      },
      agents: EMPTY_AGENTS,
    });

    const options = await createService({ exec, modelsCachePath: cachePath }).get();

    expect(options.models).toEqual([
      { id: "opencode/model-a", provider: "opencode", name: "opencode/model-a", variants: [] },
      {
        id: "anthropic/claude-x",
        provider: "anthropic",
        name: "anthropic/claude-x",
        variants: [],
      },
    ]);
  });

  it("ignores a cache that is not valid JSON", async () => {
    const cachePath = writeCache("not json");
    const { exec } = fakeExec({
      models: { code: 0, stdout: "opencode/model-a\n", stderr: "" },
      agents: EMPTY_AGENTS,
    });

    const options = await createService({ exec, modelsCachePath: cachePath }).get();

    expect(options.models).toEqual([
      { id: "opencode/model-a", provider: "opencode", name: "opencode/model-a", variants: [] },
    ]);
  });

  it("caches results for the TTL and refreshes on demand", async () => {
    const cachePath = writeCache("{}");
    const { exec, calls } = fakeExec({
      models: { code: 0, stdout: "opencode/model-a\n", stderr: "" },
      agents: EMPTY_AGENTS,
    });
    let current = 1_000;
    const service = createService({
      exec,
      modelsCachePath: cachePath,
      now: () => current,
      ttlMs: 60_000,
    });

    await service.get(false);
    await service.get(false);
    expect(countModelsCalls(calls)).toBe(1);

    await service.get(true);
    expect(countModelsCalls(calls)).toBe(2);

    current += 60_000;
    await service.get(false);
    expect(countModelsCalls(calls)).toBe(3);
  });

  it("never rejects when the injected exec rejects", async () => {
    const cachePath = writeCache("{}");
    const exec: ExecFn = async () => {
      throw new Error("spawn failed");
    };

    const options = await createService({ exec, modelsCachePath: cachePath }).get();

    expect(options.available).toBe(false);
    expect(options.reason).not.toBeNull();
    expect(options.models).toEqual([]);
    expect(options.agents).toEqual([]);
    expect(options.mcps).toEqual([]);
  });
});
