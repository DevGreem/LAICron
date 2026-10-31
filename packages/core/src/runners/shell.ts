import type { Job, RunResult, Runner } from "../types.js";
import { runProcess } from "./process.js";

const MAX_ERROR_LENGTH = 2_000;

function truncate(text: string): string {
  const trimmed = text.trim();

  return trimmed.length > MAX_ERROR_LENGTH ? trimmed.slice(0, MAX_ERROR_LENGTH) : trimmed;
}

function buildResult(startedAt: number, fields: Omit<RunResult, "durationMs">): RunResult {
  return {
    ...fields,
    durationMs: Date.now() - startedAt,
  };
}

export function createShellRunner(): Runner {
  return {
    kind: "shell",
    async run(job: Job, signal: AbortSignal): Promise<RunResult> {
      const startedAt = Date.now();
      const command = job.command?.trim() ?? "";

      if (command.length === 0) {
        return buildResult(startedAt, {
          status: "failed",
          exitCode: null,
          output: "",
          error: "el job no tiene comando definido",
          sessionId: null,
        });
      }

      // Pass the job args as positional parameters ($1, $2, ...) so the command
      // can reference them without string concatenation. $0 is set to "laicron".
      const outcome = await runProcess({
        command: "sh",
        args: ["-lc", command, "laicron", ...job.args],
        cwd: job.cwd,
        env: process.env,
        timeoutMs: job.timeoutSec * 1000,
        signal,
      });

      let output = outcome.stdout;

      if (outcome.stderr.length > 0) {
        output += `\n--- stderr ---\n${outcome.stderr}`;
      }

      if (outcome.termination === "timeout") {
        return buildResult(startedAt, {
          status: "timeout",
          exitCode: null,
          output,
          error: `timeout after ${job.timeoutSec}s`,
          sessionId: null,
        });
      }

      if (outcome.termination === "aborted") {
        return buildResult(startedAt, {
          status: "interrupted",
          exitCode: null,
          output,
          error: "aborted",
          sessionId: null,
        });
      }

      if (outcome.spawnError !== null) {
        return buildResult(startedAt, {
          status: "failed",
          exitCode: null,
          output,
          error: `no se pudo iniciar el shell: ${outcome.spawnError.message}`,
          sessionId: null,
        });
      }

      if (outcome.exitCode === 0) {
        return buildResult(startedAt, {
          status: "success",
          exitCode: 0,
          output,
          error: null,
          sessionId: null,
        });
      }

      if (outcome.exitCode === 127) {
        return buildResult(startedAt, {
          status: "failed",
          exitCode: 127,
          output,
          error: `comando no encontrado: ${command}`,
          sessionId: null,
        });
      }

      const stderrText = truncate(outcome.stderr);
      const fallback =
        outcome.exitCode !== null
          ? `command exited with code ${outcome.exitCode}`
          : `command terminated by signal ${outcome.signal ?? "unknown"}`;

      return buildResult(startedAt, {
        status: "failed",
        exitCode: outcome.exitCode,
        output,
        error: stderrText.length > 0 ? stderrText : fallback,
        sessionId: null,
      });
    },
  };
}
