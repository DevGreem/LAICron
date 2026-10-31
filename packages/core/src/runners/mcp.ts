import { execFile } from "node:child_process";

const DEFAULT_TTL_MS = 60_000;
const EXEC_TIMEOUT_MS = 5_000;
const MAX_BUFFER_BYTES = 1024 * 1024;
// ANSI color codes may wrap the marker when the CLI forces color output.
// eslint-disable-next-line no-control-regex -- matching the escape sequence is intentional.
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;
const LINE_PATTERN = /^[✓○✗]\s+(\S+)\s+(.+)$/;

export interface OpencodeMcpOption {
  name: string;
  enabled: boolean;
  status: string;
}

export interface McpExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type McpExecFn = (cmd: string, args: string[], cwd: string) => Promise<McpExecResult>;

export interface McpListerDeps {
  exec?: McpExecFn;
  now?: () => number;
  ttlMs?: number;
}

export interface McpLister {
  list(cwd: string, refresh?: boolean): Promise<OpencodeMcpOption[]>;
}

interface CacheEntry {
  storedAt: number;
  options: OpencodeMcpOption[];
}

/**
 * Default exec wrapper: runs the command in `cwd` with a hard timeout and a
 * bounded buffer, and always resolves so callers never have to catch. A missing
 * binary is reported as exit code 127, matching shell conventions.
 */
function defaultExec(command: string, args: string[], cwd: string): Promise<McpExecResult> {
  return new Promise<McpExecResult>((resolve) => {
    execFile(
      command,
      args,
      { cwd, timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_BUFFER_BYTES, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr });
          return;
        }

        const rawCode: unknown = (error as { code?: unknown }).code;
        const code = rawCode === "ENOENT" ? 127 : typeof rawCode === "number" ? rawCode : 1;

        resolve({ code, stdout, stderr });
      },
    );
  });
}

/**
 * Tolerant parser for `opencode mcp list`. Each accepted line looks like
 * `<marker> <name> <status>`; anything else is ignored. `disabled` is the only
 * status that maps to `enabled=false`, so connection failures still count as
 * enabled servers (they are configured, just unreachable).
 */
export function parseMcpList(stdout: string): OpencodeMcpOption[] {
  const options: OpencodeMcpOption[] = [];

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.replace(ANSI_PATTERN, "").trim();

    if (line.length === 0) {
      continue;
    }

    const match = LINE_PATTERN.exec(line);

    if (match === null) {
      continue;
    }

    const name = match[1];
    const status = (match[2] ?? "").trim();

    if (name === undefined || name.length === 0 || status.length === 0) {
      continue;
    }

    options.push({ name, enabled: status !== "disabled", status });
  }

  return options;
}

export function createMcpLister(deps: McpListerDeps = {}): McpLister {
  const exec = deps.exec ?? defaultExec;
  const now = deps.now ?? Date.now;
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  const cache = new Map<string, CacheEntry>();

  // Return copies so callers cannot mutate the cached catalog by accident.
  const clone = (options: OpencodeMcpOption[]): OpencodeMcpOption[] =>
    options.map((option) => ({ ...option }));

  return {
    async list(cwd: string, refresh = false): Promise<OpencodeMcpOption[]> {
      if (!refresh) {
        const cached = cache.get(cwd);

        if (cached !== undefined && now() - cached.storedAt < ttlMs) {
          return clone(cached.options);
        }
      }

      let result: McpExecResult;

      try {
        result = await exec("opencode", ["mcp", "list"], cwd);
      } catch {
        return [];
      }

      // A non-zero exit may still print a partial list; never trust it.
      if (result.code !== 0) {
        return [];
      }

      const options = parseMcpList(result.stdout);
      cache.set(cwd, { storedAt: now(), options });

      return clone(options);
    },
  };
}
