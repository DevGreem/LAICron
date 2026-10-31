import type { Job, McpState, RunResult, Runner } from "../types.js";
import { createMcpLister, type OpencodeMcpOption } from "./mcp.js";
import { parseOpencodeStream } from "./opencode-events.js";
import { runProcess } from "./process.js";

const MAX_ERROR_LENGTH = 2_000;

const NOT_INSTALLED_ERROR = "opencode no está instalado o no está en el PATH";

const MCP_LIST_WARNING =
  "[laicron] no se pudo leer la lista de MCPs; se usa la configuración heredada\n";

export interface OpencodeRunnerDeps {
  mcpLister?: { list(cwd: string, refresh?: boolean): Promise<OpencodeMcpOption[]> };
}

type McpServersOverlay = Record<string, { disabled: boolean }>;

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
    process.stderr.write(MCP_LIST_WARNING);

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

  if (Object.keys(job.mcpOverrides).length === 0) {
    return environment;
  }

  const servers = await resolveMcpOverlay(lister, job);

  if (servers !== null) {
    environment.OPENCODE_CONFIG_CONTENT = JSON.stringify({ mcp: { servers } });
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
      const outcome = await runProcess({
        command: "opencode",
        args: buildArgs(job),
        cwd: job.cwd,
        env: await buildEnvironment(environment, job, lister),
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
