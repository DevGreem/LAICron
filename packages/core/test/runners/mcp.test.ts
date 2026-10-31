import { describe, expect, it } from "vitest";

import {
  createMcpLister,
  parseMcpList,
  type McpExecFn,
  type McpExecResult,
} from "../../src/runners/index.js";

const SAMPLE = [
  "○ aseprite            disabled",
  "✓ github              connected",
  "✗ opencode_console    failed: Error POSTing to endpoint (HTTP 403)",
  "○ github-write        disabled",
].join("\n");

interface ExecCall {
  cmd: string;
  args: string[];
  cwd: string;
}

function recordingExec(calls: ExecCall[], result: McpExecResult): McpExecFn {
  return async (cmd, args, cwd) => {
    calls.push({ cmd, args, cwd });

    return result;
  };
}

describe("parseMcpList", () => {
  it("maps connected, disabled and failed statuses", () => {
    expect(parseMcpList(SAMPLE)).toEqual([
      { name: "aseprite", enabled: false, status: "disabled" },
      { name: "github", enabled: true, status: "connected" },
      {
        name: "opencode_console",
        enabled: true,
        status: "failed: Error POSTing to endpoint (HTTP 403)",
      },
      { name: "github-write", enabled: false, status: "disabled" },
    ]);
  });

  it("ignores empty, malformed and nameless lines", () => {
    const stdout = [
      "",
      "   ",
      "random text",
      "✓",
      "✓ lonely",
      "prefix ✓ github connected",
      "✓ github connected",
      "○ aseprite disabled",
      "✓ github   connected  ",
    ].join("\r\n");

    expect(parseMcpList(stdout)).toEqual([
      { name: "github", enabled: true, status: "connected" },
      { name: "aseprite", enabled: false, status: "disabled" },
      { name: "github", enabled: true, status: "connected" },
    ]);
  });
});

describe("createMcpLister", () => {
  it("runs opencode mcp list in the requested cwd", async () => {
    const calls: ExecCall[] = [];
    const lister = createMcpLister({
      exec: recordingExec(calls, { code: 0, stdout: SAMPLE, stderr: "" }),
    });

    const options = await lister.list("/tmp/project");

    expect(calls).toEqual([{ cmd: "opencode", args: ["mcp", "list"], cwd: "/tmp/project" }]);
    expect(options).toHaveLength(4);
  });

  it("caches per cwd and bypasses the cache with refresh", async () => {
    const calls: ExecCall[] = [];
    const lister = createMcpLister({
      exec: recordingExec(calls, { code: 0, stdout: "✓ github connected", stderr: "" }),
    });

    await lister.list("a");
    await lister.list("a");
    expect(calls.map((call) => call.cwd)).toEqual(["a"]);

    await lister.list("b");
    expect(calls.map((call) => call.cwd)).toEqual(["a", "b"]);

    await lister.list("a", true);
    expect(calls.map((call) => call.cwd)).toEqual(["a", "b", "a"]);
  });

  it("refetches once the ttl expires", async () => {
    const calls: ExecCall[] = [];
    let nowMs = 0;
    const lister = createMcpLister({
      exec: recordingExec(calls, { code: 0, stdout: "✓ github connected", stderr: "" }),
      now: () => nowMs,
      ttlMs: 1_000,
    });

    await lister.list("a");
    nowMs = 999;
    await lister.list("a");
    expect(calls).toHaveLength(1);

    nowMs = 1_000;
    await lister.list("a");
    expect(calls).toHaveLength(2);
  });

  it("returns an empty list when opencode is missing", async () => {
    const lister = createMcpLister({
      exec: async () => ({ code: 127, stdout: "", stderr: "spawn opencode ENOENT" }),
    });

    await expect(lister.list("a")).resolves.toEqual([]);
  });

  it("returns an empty list when exec throws", async () => {
    const lister = createMcpLister({
      exec: async () => {
        throw new Error("boom");
      },
    });

    await expect(lister.list("a")).resolves.toEqual([]);
  });

  it("ignores partial stdout when the command exits non-zero", async () => {
    const lister = createMcpLister({
      exec: async () => ({ code: 1, stdout: SAMPLE, stderr: "boom" }),
    });

    await expect(lister.list("a")).resolves.toEqual([]);
  });

  it("does not cache failures, so a later call retries", async () => {
    let attempts = 0;
    const exec: McpExecFn = async () => {
      attempts += 1;

      return attempts === 1
        ? { code: 1, stdout: "", stderr: "boom" }
        : { code: 0, stdout: "✓ github connected", stderr: "" };
    };
    const lister = createMcpLister({ exec });

    await expect(lister.list("a")).resolves.toEqual([]);
    await expect(lister.list("a")).resolves.toHaveLength(1);
    expect(attempts).toBe(2);
  });
});
