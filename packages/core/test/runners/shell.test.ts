import { describe, expect, it } from "vitest";

import { createShellRunner } from "../../src/runners/index.js";
import { makeJob } from "./job.js";

const runner = createShellRunner();

function idleSignal(): AbortSignal {
  return new AbortController().signal;
}

describe("shell runner", () => {
  it("captures stdout and reports success for exit code 0", async () => {
    const result = await runner.run(makeJob({ command: "echo hola" }), idleSignal());

    expect(result.status).toBe("success");
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("hola");
    expect(result.error).toBeNull();
    expect(result.sessionId).toBeNull();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("appends stderr below the stderr marker", async () => {
    const result = await runner.run(
      makeJob({ command: "echo salida; echo aviso >&2" }),
      idleSignal(),
    );

    expect(result.status).toBe("success");
    expect(result.output).toContain("salida");
    expect(result.output).toContain("--- stderr ---");
    expect(result.output).toContain("aviso");
  });

  it("reports a missing command as failed with exit code 127 without throwing", async () => {
    const result = await runner.run(
      makeJob({ command: "laicron-command-that-does-not-exist" }),
      idleSignal(),
    );

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(127);
    expect(result.error).not.toBeNull();
    expect(result.error).toContain("comando no encontrado");
    expect(result.error).toContain("laicron-command-that-does-not-exist");
  });

  it("reports a non-zero exit code as failed", async () => {
    const result = await runner.run(makeJob({ command: "exit 3" }), idleSignal());

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(3);
    expect(result.error).toContain("code 3");
  });

  it("passes job args as positional parameters", async () => {
    const result = await runner.run(
      makeJob({ command: 'echo "$1-$2"', args: ["a", "b"] }),
      idleSignal(),
    );

    expect(result.status).toBe("success");
    expect(result.output).toContain("a-b");
  });

  it("exposes the number of job args through $#", async () => {
    const result = await runner.run(
      makeJob({ command: "echo $#", args: ["x", "y", "z"] }),
      idleSignal(),
    );

    expect(result.status).toBe("success");
    expect(result.output).toContain("3");
  });

  it("kills the process tree on timeout and keeps partial output", async () => {
    const startedAt = Date.now();
    const result = await runner.run(
      makeJob({ command: "echo parcial; sleep 5", timeoutSec: 1 }),
      idleSignal(),
    );

    expect(result.status).toBe("timeout");
    expect(result.exitCode).toBeNull();
    expect(result.error).toBe("timeout after 1s");
    expect(result.output).toContain("parcial");
    expect(Date.now() - startedAt).toBeLessThan(4_000);
  });

  it("kills the process tree when the external signal is aborted", async () => {
    const controller = new AbortController();
    const startedAt = Date.now();
    const pending = runner.run(makeJob({ command: "sleep 5", timeoutSec: 10 }), controller.signal);

    setTimeout(() => {
      controller.abort();
    }, 200);

    const result = await pending;

    expect(result.status).toBe("interrupted");
    expect(result.exitCode).toBeNull();
    expect(result.error).toBe("aborted");
    expect(Date.now() - startedAt).toBeLessThan(3_000);
  });
});
