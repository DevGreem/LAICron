import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** A model exposed by `opencode models`, enriched from the local cache. */
export interface OpencodeModelOption {
  id: string;
  provider: string;
  name: string;
  variants: string[];
}

/** A primary agent exposed by `opencode debug agents`. */
export interface OpencodeAgentOption {
  id: string;
  name: string;
  description: string;
  mode: string;
}

/** Catalog consumed by the job form to render model, variant and agent lists. */
export interface OpencodeOptions {
  available: boolean;
  reason: string | null;
  models: OpencodeModelOption[];
  agents: OpencodeAgentOption[];
}

/** Result of running an external command. */
export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a command and resolves with its exit code and output. */
export type ExecFn = (cmd: string, args: string[]) => Promise<ExecResult>;

export interface OpencodeOptionsDeps {
  exec?: ExecFn;
  modelsCachePath?: string;
  now?: () => number;
  ttlMs?: number;
}

export interface OpencodeOptionsService {
  get(refresh?: boolean): Promise<OpencodeOptions>;
}

const DEFAULT_TTL_MS = 60_000;
const COMMAND_TIMEOUT_MS = 5_000;
const TIMEOUT_CODE = 124;
const MAX_BUFFER_BYTES = 32 * 1024 * 1024;

const NOT_INSTALLED_REASON = "opencode no está instalado o no está en el PATH";
const TIMEOUT_REASON = "opencode models agotó el tiempo de espera";
const GENERIC_REASON = "No se pudo leer el catálogo de opencode";

/**
 * Default {@link ExecFn}: wraps `execFile` in a promise and resolves for
 * non-zero exit codes and spawn failures instead of rejecting.
 */
const defaultExec: ExecFn = (cmd, args) =>
  new Promise<ExecResult>((resolvePromise) => {
    execFile(
      cmd,
      args,
      { encoding: "utf8", timeout: COMMAND_TIMEOUT_MS, maxBuffer: MAX_BUFFER_BYTES },
      (error, stdout, stderr) => {
        if (error === null) {
          resolvePromise({ code: 0, stdout, stderr });
          return;
        }

        // `execFile` reports spawn failures (ENOENT) with a string code and
        // timeouts with `killed`/`signal`, so normalize both here.
        const code =
          error.killed === true ? TIMEOUT_CODE : typeof error.code === "number" ? error.code : 127;
        resolvePromise({
          code,
          stdout: stdout ?? "",
          stderr: stderr !== undefined && stderr !== "" ? stderr : error.message,
        });
      },
    );
  });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultCachePath(): string {
  const xdg = process.env["XDG_CACHE_HOME"];
  const base = typeof xdg === "string" && xdg.trim().length > 0 ? xdg : join(homedir(), ".cache");
  return join(base, "opencode", "models.json");
}

/**
 * Runs a command with a hard deadline. The injected `exec` may never settle
 * (a broken shim, a hung child), and `get` must always resolve.
 */
function runWithTimeout(exec: ExecFn, cmd: string, args: string[]): Promise<ExecResult> {
  return new Promise<ExecResult>((resolvePromise) => {
    let settled = false;
    const finish = (result: ExecResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };

    const timer = setTimeout(() => {
      finish({ code: TIMEOUT_CODE, stdout: "", stderr: "timeout" });
    }, COMMAND_TIMEOUT_MS);

    Promise.resolve()
      .then(() => exec(cmd, args))
      .then(
        (result) => finish(result),
        (error: unknown) =>
          finish({
            code: 1,
            stdout: "",
            stderr: error instanceof Error ? error.message : String(error),
          }),
      );
  });
}

function modelsFailureReason(result: ExecResult): string {
  if (result.code === TIMEOUT_CODE) {
    return TIMEOUT_REASON;
  }
  if (result.code === 127) {
    return NOT_INSTALLED_REASON;
  }
  return `opencode models falló (código ${result.code})`;
}

function readVariants(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const seen = new Set<string>();
  const variants: string[] = [];
  for (const option of raw) {
    if (!isRecord(option)) {
      continue;
    }
    const values = option["values"];
    if (!Array.isArray(values)) {
      continue;
    }
    for (const value of values) {
      if (typeof value !== "string" || value.length === 0 || seen.has(value)) {
        continue;
      }
      seen.add(value);
      variants.push(value);
    }
  }
  return variants;
}

interface ModelMeta {
  name: string | null;
  variants: string[];
}

/** Looks up `cache[provider].models[modelId]` without trusting its shape. */
function modelMetaFromCache(cache: unknown, provider: string, modelId: string): ModelMeta | null {
  if (!isRecord(cache)) {
    return null;
  }
  const providerEntry = cache[provider];
  if (!isRecord(providerEntry)) {
    return null;
  }
  const models = providerEntry["models"];
  if (!isRecord(models)) {
    return null;
  }
  const entry = models[modelId];
  if (!isRecord(entry)) {
    return null;
  }

  const rawName = entry["name"];
  return {
    name: typeof rawName === "string" && rawName.trim().length > 0 ? rawName : null,
    variants: readVariants(entry["reasoning_options"]),
  };
}

async function readModelsCache(path: string): Promise<unknown> {
  try {
    const text = await readFile(path, "utf8");
    return JSON.parse(text) as unknown;
  } catch {
    // A missing or malformed cache only costs the display name and variants.
    return null;
  }
}

function buildModels(stdout: string, cache: unknown): OpencodeModelOption[] {
  const seen = new Set<string>();
  const models: OpencodeModelOption[] = [];

  for (const rawLine of stdout.split(/\r?\n/)) {
    const id = rawLine.trim();
    if (id.length === 0 || seen.has(id)) {
      continue;
    }
    const slash = id.indexOf("/");
    if (slash <= 0 || slash === id.length - 1) {
      continue;
    }
    seen.add(id);

    const provider = id.slice(0, slash);
    const modelId = id.slice(slash + 1);
    const meta = modelMetaFromCache(cache, provider, modelId);
    models.push({
      id,
      provider,
      name: meta?.name ?? id,
      variants: meta?.variants ?? [],
    });
  }

  return models;
}

function parseAgents(stdout: string): OpencodeAgentOption[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }

  const agents: OpencodeAgentOption[] = [];
  for (const entry of parsed) {
    if (!isRecord(entry)) {
      continue;
    }
    // Hidden agents and subagents cannot be selected as a job's primary agent.
    if (entry["hidden"] === true || entry["mode"] === "subagent") {
      continue;
    }

    const id = entry["id"];
    if (typeof id !== "string" || id.length === 0) {
      continue;
    }
    const name = entry["name"];
    const description = entry["description"];
    const mode = entry["mode"];

    // Only the four public fields are copied: `system`, `permissions`,
    // `request` and everything else stay inside the daemon.
    agents.push({
      id,
      name: typeof name === "string" && name.length > 0 ? name : id,
      description: typeof description === "string" ? description : "",
      mode: typeof mode === "string" ? mode : "primary",
    });
  }

  return agents;
}

/** Builds the catalog service; results are cached in memory for `ttlMs`. */
export function createOpencodeOptions(deps: OpencodeOptionsDeps = {}): OpencodeOptionsService {
  const exec = deps.exec ?? defaultExec;
  const modelsCachePath = deps.modelsCachePath ?? defaultCachePath();
  const now = deps.now ?? Date.now;
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;

  let cached: { at: number; value: OpencodeOptions } | null = null;

  async function load(): Promise<OpencodeOptions> {
    const modelsResult = await runWithTimeout(exec, "opencode", ["models"]);
    if (modelsResult.code !== 0) {
      return {
        available: false,
        reason: modelsFailureReason(modelsResult),
        models: [],
        agents: [],
      };
    }

    const cache = await readModelsCache(modelsCachePath);
    const models = buildModels(modelsResult.stdout, cache);

    // A broken agent listing only empties the agent list; models still work.
    const agentsResult = await runWithTimeout(exec, "opencode", ["debug", "agents"]);
    const agents = agentsResult.code === 0 ? parseAgents(agentsResult.stdout) : [];

    return { available: true, reason: null, models, agents };
  }

  async function get(refresh = false): Promise<OpencodeOptions> {
    const timestamp = now();
    if (!refresh && cached !== null && timestamp - cached.at < ttlMs) {
      return cached.value;
    }

    let value: OpencodeOptions;
    try {
      value = await load();
    } catch {
      value = { available: false, reason: GENERIC_REASON, models: [], agents: [] };
    }

    cached = { at: timestamp, value };
    return value;
  }

  return { get };
}
