import type { Job, McpState, RunResult, Runner, RunUsage } from "../types.js";
import { ensureCronInstructions } from "./cron-instructions.js";
import { createMcpLister, type OpencodeMcpOption } from "./mcp.js";
import { parseOpencodeStream } from "./opencode-events.js";
import { runProcess } from "./process.js";
import { parseSessionUsage } from "./usage.js";
import { t } from "../i18n.js";

const MAX_ERROR_LENGTH = 2_000;

/** The export runs after the execution, so it gets its own short budget. */
const SESSION_EXPORT_TIMEOUT_MS = 10_000;

/** Delay before the single retry of a failed session export. */
const SESSION_EXPORT_RETRY_DELAY_MS = 250;

export interface OpencodeRunnerDeps {
  mcpLister?: { list(cwd: string, refresh?: boolean): Promise<OpencodeMcpOption[]> };
}

type McpServersOverlay = Record<string, { disabled: boolean }>;

function truncate(text: string): string {
  const trimmed = text.trim();

  return trimmed.length > MAX_ERROR_LENGTH ? trimmed.slice(0, MAX_ERROR_LENGTH) : trimmed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

interface SessionExportRequest {
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
}

/**
 * Reads the consumption of the run from the exported session. The export is
 * best effort: a failure never changes the run outcome, it only leaves the
 * usage empty. A single retry covers a session that is still being flushed.
 */
async function readSessionUsage(
  sessionId: string,
  startedAt: number,
  request: SessionExportRequest,
): Promise<RunUsage | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) {
      await sleep(SESSION_EXPORT_RETRY_DELAY_MS);

      if (request.signal.aborted) {
        return null;
      }
    }

    const outcome = await runProcess({
      command: "opencode",
      // The run uses a private server, so its session lives in that server's
      // storage. Without `--standalone` the export asks the shared background
      // service, which does not know the session and reports "Session not found".
      args: ["session", "export", sessionId, "--sanitize", "--standalone"],
      cwd: request.cwd,
      env: request.env,
      timeoutMs: SESSION_EXPORT_TIMEOUT_MS,
      signal: request.signal,
    });

    if (outcome.termination !== null || outcome.exitCode !== 0 || outcome.spawnError !== null) {
      if (request.signal.aborted) {
        return null;
      }
      continue;
    }

    const usage = parseSessionUsage(outcome.stdout, startedAt);

    if (usage !== null) {
      return usage;
    }

    // A valid export without messages from this run is final; only a
    // malformed payload is worth retrying.
    if (isValidJson(outcome.stdout)) {
      return null;
    }
  }

  return null;
}

function buildResult(startedAt: number, fields: Omit<RunResult, "durationMs">): RunResult {
  return {
    ...fields,
    durationMs: Date.now() - startedAt,
  };
}

function buildArgs(job: Job): string[] {
  // `--standalone` is required for OPENCODE_CONFIG_CONTENT to be applied;
  // without it the shared service is used and the variable is ignored.
  const args = ["run", "--standalone", "--format", "json"];

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

/**
 * Builds the `mcp.servers` overlay from the job overrides. Names missing from
 * the catalog are dropped so a stale override never breaks the run; the overlay
 * only carries `disabled` and never copies server configuration or secrets.
 */
function buildMcpOverlay(
  overrides: Record<string, McpState>,
  known: OpencodeMcpOption[],
): McpServersOverlay | null {
  const knownNames = new Set(known.map((option) => option.name));
  const servers: McpServersOverlay = {};

  for (const [name, state] of Object.entries(overrides)) {
    if (knownNames.has(name)) {
      servers[name] = { disabled: state === "off" };
    }
  }

  return Object.keys(servers).length > 0 ? servers : null;
}

/**
 * Resolves the overlay, degrading to the inherited configuration when the
 * catalog cannot be read. A failed listing is not a run failure: the job keeps
 * going with whatever MCP configuration opencode already has.
 */
async function resolveMcpOverlay(
  lister: NonNullable<OpencodeRunnerDeps["mcpLister"]>,
  job: Job,
): Promise<McpServersOverlay | null> {
  let known: OpencodeMcpOption[];

  try {
    known = await lister.list(job.cwd);
  } catch {
    known = [];
  }

  if (known.length === 0) {
    process.stderr.write(`${t("runner.mcpListFailed")}\n`);

    return null;
  }

  return buildMcpOverlay(job.mcpOverrides, known);
}

async function buildEnvironment(
  base: NodeJS.ProcessEnv,
  job: Job,
  lister: NonNullable<OpencodeRunnerDeps["mcpLister"]>,
): Promise<NodeJS.ProcessEnv> {
  // Copy per run so an overlay never leaks into later jobs.
  const environment: NodeJS.ProcessEnv = { ...base };
  const instructionsPath = await ensureCronInstructions();
  const overlay: Record<string, unknown> = {};

  if (Object.keys(job.mcpOverrides).length > 0) {
    const servers = await resolveMcpOverlay(lister, job);

    if (servers !== null) {
      overlay["mcp"] = { servers };
    }
  }

  if (instructionsPath !== null) {
    overlay["instructions"] = [instructionsPath];
  } else {
    process.stderr.write(`${t("runner.cronInstructionFailed")}\n`);
  }

  if (Object.keys(overlay).length > 0) {
    environment.OPENCODE_CONFIG_CONTENT = JSON.stringify(overlay);
  }

  return environment;
}

export function createOpencodeRunner(env?: NodeJS.ProcessEnv, deps?: OpencodeRunnerDeps): Runner {
  const environment = env ?? process.env;
  const lister = deps?.mcpLister ?? createMcpLister();

  return {
    kind: "opencode",
    async run(job: Job, signal: AbortSignal): Promise<RunResult> {
      const startedAt = Date.now();
      const env = await buildEnvironment(environment, job, lister);
      const outcome = await runProcess({
        command: "opencode",
        args: buildArgs(job),
        cwd: job.cwd,
        env,
        timeoutMs: job.timeoutSec * 1000,
        signal,
      });
      const parsed = parseOpencodeStream(outcome.stdout);
      const usage =
        parsed.sessionId !== null
          ? await readSessionUsage(parsed.sessionId, startedAt, { cwd: job.cwd, env, signal })
          : null;

      if (outcome.termination === "timeout") {
        return buildResult(startedAt, {
          status: "timeout",
          exitCode: null,
          output: parsed.text,
          error: `timeout after ${job.timeoutSec}s`,
          sessionId: parsed.sessionId,
          usage,
        });
      }

      if (outcome.termination === "aborted") {
        return buildResult(startedAt, {
          status: "interrupted",
          exitCode: null,
          output: parsed.text,
          error: "aborted",
          sessionId: parsed.sessionId,
          usage,
        });
      }

      if (outcome.spawnError !== null) {
        const notFound = outcome.spawnError.code === "ENOENT";

        return buildResult(startedAt, {
          status: "failed",
          exitCode: null,
          output: parsed.text,
          error: notFound
            ? t("runner.opencodeMissing")
            : t("runner.opencodeStart", { detail: outcome.spawnError.message }),
          sessionId: parsed.sessionId,
          usage,
        });
      }

      if (outcome.exitCode === 0) {
        return buildResult(startedAt, {
          status: "success",
          exitCode: 0,
          output: parsed.text,
          error: null,
          sessionId: parsed.sessionId,
          usage,
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
        usage,
      });
    },
  };
}
