import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createOpencodeOptions, type ExecFn, type ExecResult } from "../src/opencode-options.js";

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

function fakeExec(results: { models?: ExecResult; agents?: ExecResult }): FakeExecResult {
  const calls: ExecCall[] = [];
  const exec: ExecFn = async (cmd, args) => {
    calls.push({ cmd, args });
    const result = args[0] === "models" ? results.models : results.agents;
    if (result === undefined) {
      return { code: 1, stdout: "", stderr: "unexpected command" };
    }
    return result;
  };
  return { exec, calls };
}

function countModelsCalls(calls: ExecCall[]): number {
  return calls.filter((call) => call.args[0] === "models").length;
}

const EMPTY_AGENTS: ExecResult = { code: 0, stdout: "[]", stderr: "" };

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

    const options = await createOpencodeOptions({ exec, modelsCachePath: cachePath }).get();

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

    const options = await createOpencodeOptions({ exec, modelsCachePath: cachePath }).get();

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

  it("returns an unavailable catalog when opencode models fails", async () => {
    const cachePath = writeCache("{}");
    const { exec } = fakeExec({ models: { code: 1, stdout: "", stderr: "boom" } });

    const service = createOpencodeOptions({ exec, modelsCachePath: cachePath });
    const options = await service.get();

    expect(options).toMatchObject({ available: false, models: [], agents: [] });
    expect(options.reason).not.toBeNull();
    expect(options.reason).toContain("opencode");
  });

  it("explains when the opencode binary is missing", async () => {
    const cachePath = writeCache("{}");
    const { exec } = fakeExec({ models: { code: 127, stdout: "", stderr: "ENOENT" } });

    const options = await createOpencodeOptions({ exec, modelsCachePath: cachePath }).get();

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

    const options = await createOpencodeOptions({ exec, modelsCachePath: cachePath }).get();

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

    const options = await createOpencodeOptions({ exec, modelsCachePath: cachePath }).get();

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

    const options = await createOpencodeOptions({ exec, modelsCachePath: cachePath }).get();

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
    const service = createOpencodeOptions({
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

    const options = await createOpencodeOptions({ exec, modelsCachePath: cachePath }).get();

    expect(options.available).toBe(false);
    expect(options.reason).not.toBeNull();
    expect(options.models).toEqual([]);
    expect(options.agents).toEqual([]);
  });
});
