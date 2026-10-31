import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import {
  createOpencodeRunner,
  createShellRunner,
  type OpencodeMcpOption,
} from "../../src/runners/index.js";
import { cronInstructionsPath } from "../../src/runners/cron-instructions.js";
import { makeJob } from "./job.js";

const baseDir = mkdtempSync(join(tmpdir(), "laicron-mcp-overlay-"));
const fakeBinDir = join(baseDir, "bin");
const fakeBin = join(fakeBinDir, "opencode");
// Keep the generated instruction file out of the real home directory.
const dataHome = join(baseDir, "data");
const previousDataHome = process.env.XDG_DATA_HOME;

process.env.XDG_DATA_HOME = dataHome;

mkdirSync(fakeBinDir, { recursive: true });

// Fake binary: emits one valid NDJSON text event and optionally captures the
// overlay, whether the variable is defined and the received arguments.
const FAKE_OPENCODE = [
  "#!/bin/sh",
  'if [ -n "${CAPTURE:-}" ]; then',
  '  printf \'%s\' "${OPENCODE_CONFIG_CONTENT-}" > "$CAPTURE"',
  "fi",
  'if [ -n "${PRESENCE:-}" ]; then',
  '  if [ -n "${OPENCODE_CONFIG_CONTENT+x}" ]; then',
  "    printf 'set' > \"$PRESENCE\"",
  "  else",
  "    printf 'unset' > \"$PRESENCE\"",
  "  fi",
  "fi",
  'if [ -n "${ARGS_CAPTURE:-}" ]; then',
  '  printf \'%s\' "$*" > "$ARGS_CAPTURE"',
  "fi",
  'printf \'{"type":"text","part":{"text":"ok"}}\\n\'',
].join("\n");

writeFileSync(fakeBin, FAKE_OPENCODE);
chmodSync(fakeBin, 0o755);

afterAll(() => {
  if (previousDataHome === undefined) {
    delete process.env.XDG_DATA_HOME;
  } else {
    process.env.XDG_DATA_HOME = previousDataHome;
  }

  rmSync(baseDir, { recursive: true, force: true });
});

const GITHUB: OpencodeMcpOption = { name: "github", enabled: true, status: "connected" };
const XERJ: OpencodeMcpOption = { name: "xerj", enabled: false, status: "disabled" };
const SUPER_PRODUCTIVITY: OpencodeMcpOption = {
  name: "super-productivity",
  enabled: true,
  status: "connected",
};

interface EnvFiles {
  capture?: string;
  presence?: string;
  args?: string;
}

function capturePath(name: string): string {
  return join(baseDir, `${name}.json`);
}

function makeEnv(files: EnvFiles): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
  };

  // Keep assertions independent from the host environment.
  delete env.OPENCODE_CONFIG_CONTENT;

  if (files.capture !== undefined) {
    env.CAPTURE = files.capture;
  }
  if (files.presence !== undefined) {
    env.PRESENCE = files.presence;
  }
  if (files.args !== undefined) {
    env.ARGS_CAPTURE = files.args;
  }

  return env;
}

function listerReturning(options: OpencodeMcpOption[]) {
  return { list: vi.fn(async () => options) };
}

interface CapturedOverlay {
  mcp?: { servers: Record<string, { disabled: boolean }> };
  instructions?: string[];
}

function readOverlay(path: string): CapturedOverlay {
  return JSON.parse(readFileSync(path, "utf8")) as CapturedOverlay;
}

function idleSignal(): AbortSignal {
  return new AbortController().signal;
}

describe("opencode runner MCP overlay", () => {
  it("sends only overridden MCPs that exist in the catalog", async () => {
    const capture = capturePath("known");
    const presence = capturePath("known-presence");
    const lister = listerReturning([GITHUB, XERJ, SUPER_PRODUCTIVITY]);
    const runner = createOpencodeRunner(makeEnv({ capture, presence }), { mcpLister: lister });

    const result = await runner.run(
      makeJob({
        runner: "opencode",
        prompt: "hola",
        mcpOverrides: { github: "on", xerj: "off" },
      }),
      idleSignal(),
    );

    expect(result.status).toBe("success");
    expect(readFileSync(presence, "utf8")).toBe("set");

    const overlay = readOverlay(capture);

    expect(overlay.mcp).toEqual({
      servers: { github: { disabled: false }, xerj: { disabled: true } },
    });
    expect(overlay.instructions).toEqual([cronInstructionsPath()]);
    expect(readFileSync(capture, "utf8")).not.toContain("super-productivity");
    expect(lister.list).toHaveBeenCalledTimes(1);
    expect(lister.list).toHaveBeenCalledWith(process.cwd());
  });

  it("drops overrides for unknown MCPs and only injects the instruction", async () => {
    const capture = capturePath("ghost");
    const presence = capturePath("ghost-presence");
    const runner = createOpencodeRunner(makeEnv({ capture, presence }), {
      mcpLister: listerReturning([GITHUB]),
    });

    const result = await runner.run(
      makeJob({ runner: "opencode", prompt: "hola", mcpOverrides: { ghost: "on" } }),
      idleSignal(),
    );

    expect(result.status).toBe("success");
    expect(readFileSync(presence, "utf8")).toBe("set");

    const overlay = readOverlay(capture);

    expect(overlay.mcp).toBeUndefined();
    expect(overlay.instructions).toEqual([cronInstructionsPath()]);
  });

  it("does not list MCPs when the job has no overrides", async () => {
    const capture = capturePath("empty");
    const presence = capturePath("empty-presence");
    const lister = listerReturning([GITHUB]);
    const runner = createOpencodeRunner(makeEnv({ capture, presence }), { mcpLister: lister });

    const result = await runner.run(
      makeJob({ runner: "opencode", prompt: "hola", mcpOverrides: {} }),
      idleSignal(),
    );

    expect(result.status).toBe("success");
    expect(lister.list).not.toHaveBeenCalled();
    expect(readFileSync(presence, "utf8")).toBe("set");

    const overlay = readOverlay(capture);

    expect(overlay.mcp).toBeUndefined();
    expect(overlay.instructions).toEqual([cronInstructionsPath()]);
  });

  it("degrades to the inherited configuration when the catalog is empty", async () => {
    const capture = capturePath("failed-list");
    const presence = capturePath("failed-list-presence");
    const runner = createOpencodeRunner(makeEnv({ capture, presence }), {
      mcpLister: listerReturning([]),
    });
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      const result = await runner.run(
        makeJob({ runner: "opencode", prompt: "hola", mcpOverrides: { github: "on" } }),
        idleSignal(),
      );

      // A failed listing is not a run failure.
      expect(result.status).toBe("success");
      expect(readFileSync(presence, "utf8")).toBe("set");

      const overlay = readOverlay(capture);

      expect(overlay.mcp).toBeUndefined();
      expect(overlay.instructions).toEqual([cronInstructionsPath()]);

      const written = writeSpy.mock.calls.map((call) => String(call[0])).join("");

      expect(written).toContain(
        "[laicron] no se pudo leer la lista de MCPs; se usa la configuración heredada",
      );
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("does not leak an overlay into later runs of the same runner", async () => {
    const capture = capturePath("leak");
    const presence = capturePath("leak-presence");
    const lister = listerReturning([GITHUB]);
    const runner = createOpencodeRunner(makeEnv({ capture, presence }), { mcpLister: lister });

    await runner.run(
      makeJob({ runner: "opencode", prompt: "hola", mcpOverrides: { github: "on" } }),
      idleSignal(),
    );
    await runner.run(
      makeJob({ runner: "opencode", prompt: "adios", mcpOverrides: {} }),
      idleSignal(),
    );

    expect(lister.list).toHaveBeenCalledTimes(1);
    expect(readFileSync(presence, "utf8")).toBe("set");

    const overlay = readOverlay(capture);

    expect(overlay.mcp).toBeUndefined();
    expect(overlay.instructions).toEqual([cronInstructionsPath()]);
  });

  it("leaves the shell runner untouched", async () => {
    const result = await createShellRunner().run(
      makeJob({
        command: 'echo "${OPENCODE_CONFIG_CONTENT:-unset}"',
        mcpOverrides: { github: "on" },
      }),
      idleSignal(),
    );

    expect(result.status).toBe("success");
    expect(result.output).toContain("unset");
  });

  it("keeps the prompt as the last argument when an overlay is applied", async () => {
    const capture = capturePath("argv");
    const presence = capturePath("argv-presence");
    const argsCapture = capturePath("argv-args");
    const runner = createOpencodeRunner(makeEnv({ capture, presence, args: argsCapture }), {
      mcpLister: listerReturning([GITHUB]),
    });

    const result = await runner.run(
      makeJob({
        runner: "opencode",
        args: ["--foo", "bar"],
        prompt: "hola",
        mcpOverrides: { github: "on" },
      }),
      idleSignal(),
    );

    expect(result.status).toBe("success");

    const received = readFileSync(argsCapture, "utf8").split(" ");

    expect(received[received.length - 1]).toBe("hola");
    expect(readFileSync(argsCapture, "utf8")).toBe("run --standalone --format json --foo bar hola");
  });
});
