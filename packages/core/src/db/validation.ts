import { homedir } from "node:os";

import type {
  CatchUpPolicy,
  McpState,
  NotifyOn,
  OverlapPolicy,
  RunnerKind,
  ScheduleKind,
  SessionMode,
} from "../types.js";
import { ValidationError } from "./errors.js";
import type { CreateJobInput } from "./repository-types.js";

const RUNNERS: readonly RunnerKind[] = ["opencode", "shell"];
const SCHEDULE_KINDS: readonly ScheduleKind[] = ["cron", "interval", "once"];
const CATCH_UP_POLICIES: readonly CatchUpPolicy[] = ["none", "once", "all"];
const OVERLAP_POLICIES: readonly OverlapPolicy[] = ["skip", "queue", "kill"];
const SESSION_MODES: readonly SessionMode[] = ["independent", "continuous"];
const NOTIFY_ON_VALUES: readonly NotifyOn[] = ["always", "failure", "success"];
const MCP_STATES: readonly McpState[] = ["on", "off"];
const MAX_MCP_OVERRIDES = 100;

/** Job fields with every default already applied but no validation performed yet. */
export interface ResolvedJobFields {
  name: string;
  enabled: boolean;
  runner: RunnerKind;
  prompt: string | null;
  command: string | null;
  args: string[];
  cwd: string;
  model: string | null;
  agent: string | null;
  sessionMode: SessionMode;
  sessionId: string | null;
  scheduleKind: ScheduleKind;
  scheduleExpr: string;
  timezone: string;
  catchUp: CatchUpPolicy;
  catchUpLimit: number;
  overlap: OverlapPolicy;
  timeoutSec: number;
  notify: boolean;
  notifyOn: NotifyOn;
  mcpOverrides: Record<string, McpState>;
}

function systemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
}

/** Fills the documented defaults; validation is a separate step. */
export function applyJobDefaults(input: CreateJobInput): ResolvedJobFields {
  return {
    name: input.name,
    enabled: input.enabled ?? true,
    runner: input.runner,
    prompt: input.prompt ?? null,
    command: input.command ?? null,
    args: input.args ?? [],
    cwd: input.cwd ?? homedir(),
    model: input.model ?? null,
    agent: input.agent ?? null,
    sessionMode: input.sessionMode ?? "independent",
    sessionId: input.sessionId ?? null,
    scheduleKind: input.scheduleKind,
    scheduleExpr: input.scheduleExpr,
    timezone: input.timezone ?? systemTimezone(),
    catchUp: input.catchUp ?? "once",
    catchUpLimit: input.catchUpLimit ?? 10,
    overlap: input.overlap ?? "skip",
    timeoutSec: input.timeoutSec ?? 600,
    notify: input.notify ?? true,
    notifyOn: input.notifyOn ?? "always",
    mcpOverrides: normalizeMcpOverrides(input.mcpOverrides),
  };
}

function fail(field: string, message: string): never {
  throw new ValidationError(field, message);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Normalizes the MCP overrides accepted by the API. `undefined` means everything is inherited,
 * `"inherit"` and empty names are dropped, and any other value outside `on`/`off` is rejected.
 */
export function normalizeMcpOverrides(value: unknown): Record<string, McpState> {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    fail("mcpOverrides", "Los MCPs deben ser un objeto de nombre a on u off.");
  }

  const entries: Array<[string, McpState]> = [];
  for (const [name, state] of Object.entries(value)) {
    if (name.trim().length === 0 || state === "inherit") {
      continue;
    }
    if (!MCP_STATES.includes(state as McpState)) {
      fail("mcpOverrides", `El estado del MCP ${name} debe ser on u off.`);
    }
    entries.push([name, state as McpState]);
  }
  if (entries.length > MAX_MCP_OVERRIDES) {
    fail("mcpOverrides", `No se pueden fijar más de ${MAX_MCP_OVERRIDES} MCPs.`);
  }
  return Object.fromEntries(entries);
}

function isValidTimezone(value: unknown): boolean {
  if (!isNonEmptyString(value)) {
    return false;
  }
  try {
    // Throws RangeError for unknown IANA identifiers.
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function isValidCronExpression(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  return fields.length === 5 && fields.every((field) => field.length > 0);
}

function isValidIntervalExpression(expr: string): boolean {
  return /^\d+[mh]$/.test(expr.trim());
}

function isValidOnceExpression(expr: string): boolean {
  const trimmed = expr.trim();
  return trimmed.length > 0 && Number.isFinite(Date.parse(trimmed));
}

function validateScheduleExpression(kind: ScheduleKind, expr: unknown): void {
  if (!isNonEmptyString(expr)) {
    fail("scheduleExpr", "La expresión de programación es obligatoria.");
  }
  switch (kind) {
    case "cron":
      if (!isValidCronExpression(expr)) {
        fail("scheduleExpr", "La expresión cron debe tener exactamente cinco campos.");
      }
      break;
    case "interval":
      if (!isValidIntervalExpression(expr)) {
        fail("scheduleExpr", "El intervalo debe tener la forma 15m o 2h.");
      }
      break;
    case "once":
      if (!isValidOnceExpression(expr)) {
        fail("scheduleExpr", "La fecha única debe ser una fecha ISO válida.");
      }
      break;
    default:
      fail("scheduleKind", "El tipo de programación debe ser cron, interval o once.");
  }
}

/** Validates a fully merged job. Throws the first `ValidationError` found. */
export function validateJobFields(job: ResolvedJobFields): void {
  if (typeof job.name !== "string" || job.name.trim().length === 0) {
    fail("name", "El nombre es obligatorio.");
  }
  if (job.name.trim().length > 100) {
    fail("name", "El nombre no puede superar los 100 caracteres.");
  }

  if (!RUNNERS.includes(job.runner)) {
    fail("runner", "El ejecutor debe ser opencode o shell.");
  }
  if (job.runner === "opencode" && !isNonEmptyString(job.prompt)) {
    fail("prompt", "El prompt es obligatorio para el ejecutor opencode.");
  }
  if (job.runner === "shell" && !isNonEmptyString(job.command)) {
    fail("command", "El comando es obligatorio para el ejecutor shell.");
  }
  if (job.prompt !== null && typeof job.prompt !== "string") {
    fail("prompt", "El prompt debe ser texto o nulo.");
  }
  if (job.command !== null && typeof job.command !== "string") {
    fail("command", "El comando debe ser texto o nulo.");
  }

  if (!Array.isArray(job.args) || !job.args.every((arg) => typeof arg === "string")) {
    fail("args", "Los argumentos deben ser una lista de textos.");
  }
  if (!isNonEmptyString(job.cwd)) {
    fail("cwd", "El directorio de trabajo es obligatorio.");
  }
  if (job.model !== null && typeof job.model !== "string") {
    fail("model", "El modelo debe ser texto o nulo.");
  }
  if (job.agent !== null && typeof job.agent !== "string") {
    fail("agent", "El agente debe ser texto o nulo.");
  }

  if (!SESSION_MODES.includes(job.sessionMode)) {
    fail("sessionMode", "El modo de sesión debe ser independent o continuous.");
  }
  if (job.sessionId !== null && typeof job.sessionId !== "string") {
    fail("sessionId", "El identificador de sesión debe ser texto o nulo.");
  }

  if (!SCHEDULE_KINDS.includes(job.scheduleKind)) {
    fail("scheduleKind", "El tipo de programación debe ser cron, interval o once.");
  }
  validateScheduleExpression(job.scheduleKind, job.scheduleExpr);

  if (!isValidTimezone(job.timezone)) {
    fail("timezone", "La zona horaria no es una zona IANA válida.");
  }

  if (!CATCH_UP_POLICIES.includes(job.catchUp)) {
    fail("catchUp", "La política de recuperación debe ser none, once o all.");
  }
  if (!Number.isInteger(job.catchUpLimit) || job.catchUpLimit < 1 || job.catchUpLimit > 100) {
    fail("catchUpLimit", "El límite de recuperación debe estar entre 1 y 100.");
  }

  if (!OVERLAP_POLICIES.includes(job.overlap)) {
    fail("overlap", "La política de solapamiento debe ser skip, queue o kill.");
  }
  if (!Number.isInteger(job.timeoutSec) || job.timeoutSec < 1 || job.timeoutSec > 86400) {
    fail("timeoutSec", "El tiempo máximo debe estar entre 1 y 86400 segundos.");
  }

  if (typeof job.notify !== "boolean") {
    fail("notify", "La notificación debe ser verdadera o falsa.");
  }
  if (!NOTIFY_ON_VALUES.includes(job.notifyOn)) {
    fail("notifyOn", "El aviso debe ser always, failure o success.");
  }
  if (typeof job.enabled !== "boolean") {
    fail("enabled", "El estado debe ser verdadero o falso.");
  }
}
