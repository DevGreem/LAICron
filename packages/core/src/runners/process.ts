import { spawn, type ChildProcess } from "node:child_process";

const FORCE_KILL_DELAY_MS = 2_000;

export type TerminationReason = "timeout" | "aborted" | null;

export interface ProcessOutcome {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  termination: TerminationReason;
  spawnError: NodeJS.ErrnoException | null;
}

export interface ProcessRequest {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  signal: AbortSignal;
}

function emptyOutcome(termination: TerminationReason): ProcessOutcome {
  return {
    exitCode: null,
    signal: null,
    stdout: "",
    stderr: "",
    termination,
    spawnError: null,
  };
}

function toSpawnError(error: unknown): NodeJS.ErrnoException {
  if (error instanceof Error) {
    return error as NodeJS.ErrnoException;
  }

  return new Error(String(error));
}

/**
 * Spawns a detached child process, captures both streams and enforces the
 * timeout/abort contract. The child runs in its own process group so that the
 * whole tree can be terminated with a single signal.
 */
export function runProcess(request: ProcessRequest): Promise<ProcessOutcome> {
  const { command, args, cwd, env, timeoutMs, signal } = request;

  if (signal.aborted) {
    return Promise.resolve(emptyOutcome("aborted"));
  }

  return new Promise<ProcessOutcome>((resolve) => {
    let child: ChildProcess;

    try {
      child = spawn(command, args, {
        cwd,
        env,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const outcome = emptyOutcome(null);
      outcome.spawnError = toSpawnError(error);
      resolve(outcome);
      return;
    }

    let stdout = "";
    let stderr = "";
    let termination: TerminationReason = null;
    let spawnError: NodeJS.ErrnoException | null = null;
    let settled = false;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const killGroup = (killSignal: NodeJS.Signals): void => {
      if (child.pid === undefined) {
        return;
      }

      try {
        process.kill(-child.pid, killSignal);
      } catch {
        // The process group is already gone; nothing left to terminate.
      }
    };

    const terminate = (reason: Exclude<TerminationReason, null>): void => {
      if (termination !== null) {
        return;
      }

      termination = reason;
      killGroup("SIGTERM");
      forceKillTimer = setTimeout(() => {
        killGroup("SIGKILL");
      }, FORCE_KILL_DELAY_MS);
    };

    const onAbort = (): void => {
      terminate("aborted");
    };

    const cleanup = (): void => {
      if (timeoutTimer !== undefined) {
        clearTimeout(timeoutTimer);
      }
      if (forceKillTimer !== undefined) {
        clearTimeout(forceKillTimer);
      }
      signal.removeEventListener("abort", onAbort);
    };

    const finish = (exitCode: number | null, exitSignal: NodeJS.Signals | null): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve({
        exitCode,
        signal: exitSignal,
        stdout,
        stderr,
        termination,
        spawnError,
      });
    };

    child.once("error", (error: Error) => {
      spawnError = toSpawnError(error);
      finish(null, null);
    });
    child.once("close", (exitCode: number | null, exitSignal: NodeJS.Signals | null) => {
      finish(exitCode, exitSignal);
    });

    signal.addEventListener("abort", onAbort, { once: true });

    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        terminate("timeout");
      }, timeoutMs);
    }
  });
}
