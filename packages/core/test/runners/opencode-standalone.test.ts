import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CRON_INSTRUCTIONS,
  cronInstructionsPath,
  ensureCronInstructions,
} from "../../src/runners/cron-instructions.js";
import { createOpencodeRunner, type OpencodeMcpOption } from "../../src/runners/index.js";
import { makeJob } from "./job.js";

const baseDir = mkdtempSync(join(tmpdir(), "laicron-standalone-"));
const fakeBinDir = join(baseDir, "bin");
const fakeBin = join(fakeBinDir, "opencode");

mkdirSync(fakeBinDir, { recursive: true });

// Fake binary: records each argument on its own line, captures the inline
// configuration and emits one valid NDJSON text event.
const FAKE_OPENCODE = [
  "#!/bin/sh",
  'for arg in "$@"; do',
  "  printf '%s\\n' \"$arg\"",
  'done > "$ARGS_FILE"',
  'printf \'%s\' "${OPENCODE_CONFIG_CONTENT-}" > "$CAPTURE"',
  'printf \'{"type":"text","part":{"text":"ok"}}\\n\'',
].join("\n");

writeFileSync(fakeBin, FAKE_OPENCODE);
chmodSync(fakeBin, 0o755);

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

const GITHUB: OpencodeMcpOption = { name: "github", enabled: true, status: "connected" };

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

function capturePath(name: string): string {
  return join(baseDir, `${name}.json`);
}

function makeEnv(files: { args: string; capture: string }): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
  };

  // Keep assertions independent from the host environment.
  delete env.OPENCODE_CONFIG_CONTENT;

  env.ARGS_FILE = files.args;
  env.CAPTURE = files.capture;

  return env;
}

function readArgs(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.length > 0);
}

function readOverlay(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function idleSignal(): AbortSignal {
  return new AbortController().signal;
}

describe("opencode runner standalone mode", () => {
  it("passes --standalone right after run and keeps the prompt last", async () => {
    const argsFile = capturePath("argv");
    const runner = createOpencodeRunner(
      makeEnv({ args: argsFile, capture: capturePath("argv-overlay") }),
    );

    const result = await runner.run(
      makeJob({ runner: "opencode", args: ["--foo", "bar"], prompt: "hola" }),
      idleSignal(),
    );

    expect(result.status).toBe("success");

    const received = readArgs(argsFile);

    expect(received).toEqual(["run", "--standalone", "--format", "json", "--foo", "bar", "hola"]);
    expect(received[received.length - 1]).toBe("hola");
  });

  it("injects the cron instruction even without MCP overrides", async () => {
    const capture = capturePath("instructions");
    const lister = { list: vi.fn(async () => [GITHUB]) };
    const runner = createOpencodeRunner(
      makeEnv({ args: capturePath("instructions-argv"), capture }),
      {
        mcpLister: lister,
      },
    );

    const result = await runner.run(
      makeJob({ runner: "opencode", prompt: "hola", mcpOverrides: {} }),
      idleSignal(),
    );

    expect(result.status).toBe("success");
    expect(lister.list).not.toHaveBeenCalled();

    const overlay = readOverlay(capture);

    expect(overlay["instructions"]).toEqual([cronInstructionsPath()]);
    expect(overlay["mcp"]).toBeUndefined();
    expect(cronInstructionsPath().startsWith(dataDir)).toBe(true);
    expect(existsSync(cronInstructionsPath())).toBe(true);
    expect(readFileSync(cronInstructionsPath(), "utf8")).toBe(CRON_INSTRUCTIONS);
  });

  it("merges the MCP overlay and the instruction in the same configuration", async () => {
    const capture = capturePath("merged");
    const lister = { list: vi.fn(async () => [GITHUB]) };
    const runner = createOpencodeRunner(makeEnv({ args: capturePath("merged-argv"), capture }), {
      mcpLister: lister,
    });

    const result = await runner.run(
      makeJob({ runner: "opencode", prompt: "hola", mcpOverrides: { github: "on" } }),
      idleSignal(),
    );

    expect(result.status).toBe("success");
    expect(lister.list).toHaveBeenCalledTimes(1);

    const overlay = readOverlay(capture);

    expect(overlay["mcp"]).toEqual({ servers: { github: { disabled: false } } });
    expect(overlay["instructions"]).toEqual([cronInstructionsPath()]);
  });

  it("rewrites the instruction file when it differs from the constant", async () => {
    const path = cronInstructionsPath();

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "contenido editado a mano");

    await expect(ensureCronInstructions()).resolves.toBe(path);
    expect(readFileSync(path, "utf8")).toBe(CRON_INSTRUCTIONS);
  });

  it("warns and runs without the instruction when it cannot be prepared", async () => {
    const blocker = join(dataDir, "blocker");
    const capture = capturePath("no-instructions");

    writeFileSync(blocker, "not a directory");
    process.env.XDG_DATA_HOME = blocker;

    const runner = createOpencodeRunner(
      makeEnv({ args: capturePath("no-instructions-argv"), capture }),
    );
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      const result = await runner.run(
        makeJob({ runner: "opencode", prompt: "hola", mcpOverrides: {} }),
        idleSignal(),
      );

      expect(result.status).toBe("success");
      expect(readFileSync(capture, "utf8")).toBe("");

      const written = writeSpy.mock.calls.map((call) => String(call[0])).join("");

      expect(written).toContain(
        "[laicron] no se pudo preparar la instrucción de cron; se ejecuta sin ella",
      );
    } finally {
      writeSpy.mockRestore();
    }
  });
});
