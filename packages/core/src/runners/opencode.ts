import type { Job, RunResult, Runner } from "../types.js";
import { parseOpencodeStream } from "./opencode-events.js";
import { runProcess } from "./process.js";

const MAX_ERROR_LENGTH = 2_000;

const NOT_INSTALLED_ERROR = "opencode no está instalado o no está en el PATH";

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

function buildArgs(job: Job): string[] {
  const args = ["run", "--format", "json"];

  if (job.model) {
    args.push("--model", job.model);
  }
  if (job.agent) {
    args.push("--agent", job.agent);
  }
  if (job.sessionMode === "continuous" && job.sessionId) {
    args.push("-s", job.sessionId);
  }

  // Extra job args go before the prompt, which must stay the last argument.
  args.push(...job.args);
  args.push(job.prompt ?? "");

  return args;
}

export function createOpencodeRunner(env?: NodeJS.ProcessEnv): Runner {
  const environment = env ?? process.env;

  return {
    kind: "opencode",
    async run(job: Job, signal: AbortSignal): Promise<RunResult> {
      const startedAt = Date.now();
      const outcome = await runProcess({
        command: "opencode",
        args: buildArgs(job),
        cwd: job.cwd,
        env: environment,
        timeoutMs: job.timeoutSec * 1000,
        signal,
      });
      const parsed = parseOpencodeStream(outcome.stdout);

      if (outcome.termination === "timeout") {
        return buildResult(startedAt, {
          status: "timeout",
          exitCode: null,
          output: parsed.text,
          error: `timeout after ${job.timeoutSec}s`,
          sessionId: parsed.sessionId,
        });
      }

      if (outcome.termination === "aborted") {
        return buildResult(startedAt, {
          status: "interrupted",
          exitCode: null,
          output: parsed.text,
          error: "aborted",
          sessionId: parsed.sessionId,
        });
      }

      if (outcome.spawnError !== null) {
        const notFound = outcome.spawnError.code === "ENOENT";

        return buildResult(startedAt, {
          status: "failed",
          exitCode: null,
          output: parsed.text,
          error: notFound
            ? NOT_INSTALLED_ERROR
            : `no se pudo iniciar opencode: ${outcome.spawnError.message}`,
          sessionId: parsed.sessionId,
        });
      }

      if (outcome.exitCode === 0) {
        return buildResult(startedAt, {
          status: "success",
          exitCode: 0,
          output: parsed.text,
          error: null,
          sessionId: parsed.sessionId,
        });
      }

      const stderrText = truncate(outcome.stderr);
      const errorText =
        parsed.lastError !== null
          ? truncate(parsed.lastError)
          : stderrText.length > 0
            ? stderrText
            : outcome.exitCode !== null
              ? `opencode exited with code ${outcome.exitCode}`
              : `opencode terminated by signal ${outcome.signal ?? "unknown"}`;

      return buildResult(startedAt, {
        status: "failed",
        exitCode: outcome.exitCode,
        output: parsed.text,
        error: errorText,
        sessionId: parsed.sessionId,
      });
    },
  };
}
