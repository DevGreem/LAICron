import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { createOpencodeRunner } from "../../src/runners/index.js";
import { makeJob } from "./job.js";

const baseDir = mkdtempSync(join(tmpdir(), "laicron-opencode-usage-"));
const fakeBinDir = join(baseDir, "bin");
const fakeBin = join(fakeBinDir, "opencode");

mkdirSync(fakeBinDir, { recursive: true });

// Fake binary: `run` emits a session id and one text event; `session export`
// records its arguments and prints the fixture or fails, depending on the env.
const FAKE_OPENCODE = [
  "#!/bin/sh",
  'if [ "$1" = "run" ]; then',
  `  printf '%s\\n' '{"type":"step_start","sessionID":"ses_usage_test"}'`,
  `  printf '%s\\n' '{"type":"text","part":{"text":"ok"}}'`,
  "  exit 0",
  "fi",
  'if [ "$1" = "session" ] && [ "$2" = "export" ]; then',
  '  printf \'%s\\n\' "$@" > "$EXPORT_ARGS"',
  "  printf 'call\\n' >> \"$EXPORT_CALLS\"",
  '  if [ "${EXPORT_EXIT:-0}" != "0" ]; then',
  '    exit "$EXPORT_EXIT"',
  "  fi",
  '  cat "$EXPORT_FILE"',
  "  exit 0",
  "fi",
  "exit 1",
].join("\n");

writeFileSync(fakeBin, FAKE_OPENCODE);
chmodSync(fakeBin, 0o755);

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

let dataDir = "";
let originalXdgDataHome: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(baseDir, "data-"));
  originalXdgDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dataDir;
});

afterEach(() => {
  if (originalXdgDataHome === undefined) {
    delete process.env.XDG_DATA_HOME;
  } else {
    process.env.XDG_DATA_HOME = originalXdgDataHome;
  }

  rmSync(dataDir, { recursive: true, force: true });
});

interface EnvFiles {
  exportFile: string;
  argsFile: string;
  callsFile: string;
  exitCode?: number;
}

function makeEnv(files: EnvFiles): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
    EXPORT_FILE: files.exportFile,
    EXPORT_ARGS: files.argsFile,
    EXPORT_CALLS: files.callsFile,
    EXPORT_EXIT: String(files.exitCode ?? 0),
  };

  // Keep assertions independent from the host environment.
  delete env.OPENCODE_CONFIG_CONTENT;

  return env;
}

function readLines(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.length > 0);
}

function assistant(created: number, cost: number, tokens: Record<string, unknown>): unknown {
  return { type: "assistant", time: { created }, cost, tokens };
}

describe("opencode runner usage", () => {
  it("reads the consumption of the run from the exported session", async () => {
    const exportFile = join(baseDir, "export.json");
    const argsFile = join(baseDir, "export-args.txt");
    const callsFile = join(baseDir, "export-calls.txt");
    const created = Date.now() + 60_000;

    writeFileSync(
      exportFile,
      JSON.stringify({
        info: { id: "ses_usage_test" },
        messages: [
          // Previous messages of the same session must not be counted.
          assistant(1, 9, { input: 9_999, output: 9_999, cache: { read: 9_999, write: 9_999 } }),
          assistant(created, 0.125, {
            input: 120,
            output: 30,
            reasoning: 5,
            cache: { read: 1_000, write: 20 },
          }),
        ],
      }),
    );

    const runner = createOpencodeRunner(makeEnv({ exportFile, argsFile, callsFile }));
    const result = await runner.run(
      makeJob({ runner: "opencode", prompt: "hola" }),
      new AbortController().signal,
    );

    expect(result.status).toBe("success");
    expect(result.usage).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      reasoningTokens: 5,
      cacheReadTokens: 1_000,
      cacheWriteTokens: 20,
      costUsd: 0.125,
    });
    expect(readLines(argsFile)).toEqual([
      "session",
      "export",
      "ses_usage_test",
      "--sanitize",
      "--standalone",
    ]);
    expect(readLines(callsFile)).toHaveLength(1);
  });

  it("keeps the run successful with a null usage when the export fails", async () => {
    const argsFile = join(baseDir, "fail-args.txt");
    const callsFile = join(baseDir, "fail-calls.txt");
    const runner = createOpencodeRunner(
      makeEnv({
        exportFile: join(baseDir, "unused.json"),
        argsFile,
        callsFile,
        exitCode: 1,
      }),
    );

    const result = await runner.run(
      makeJob({ runner: "opencode", prompt: "hola" }),
      new AbortController().signal,
    );

    expect(result.status).toBe("success");
    expect(result.usage).toBeNull();
    // One initial attempt plus the single retry.
    expect(readLines(callsFile)).toHaveLength(2);
  });
});
