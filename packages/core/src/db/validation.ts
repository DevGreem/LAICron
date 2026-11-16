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
import { t } from "../i18n.js";
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
    fail("mcpOverrides", t("validation.mcpObject"));
  }

  const entries: Array<[string, McpState]> = [];
  for (const [name, state] of Object.entries(value)) {
    if (name.trim().length === 0 || state === "inherit") {
      continue;
    }
    if (!MCP_STATES.includes(state as McpState)) {
      fail("mcpOverrides", t("validation.mcpState", { name }));
    }
    entries.push([name, state as McpState]);
  }
  if (entries.length > MAX_MCP_OVERRIDES) {
    fail("mcpOverrides", t("validation.mcpLimit", { limit: MAX_MCP_OVERRIDES }));
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
    fail("scheduleExpr", t("validation.scheduleExprRequired"));
  }
  switch (kind) {
    case "cron":
      if (!isValidCronExpression(expr)) {
        fail("scheduleExpr", t("validation.cronFiveFields"));
      }
      break;
    case "interval":
      if (!isValidIntervalExpression(expr)) {
        fail("scheduleExpr", t("validation.intervalShape"));
      }
      break;
    case "once":
      if (!isValidOnceExpression(expr)) {
        fail("scheduleExpr", t("validation.onceIso"));
      }
      break;
    default:
      fail("scheduleKind", t("validation.scheduleKind"));
  }
}

/** Validates a fully merged job. Throws the first `ValidationError` found. */
export function validateJobFields(job: ResolvedJobFields): void {
  if (typeof job.name !== "string" || job.name.trim().length === 0) {
    fail("name", t("validation.nameRequired"));
  }
  if (job.name.trim().length > 100) {
    fail("name", t("validation.nameTooLong"));
  }

  if (!RUNNERS.includes(job.runner)) {
    fail("runner", t("validation.runner"));
  }
  if (job.runner === "opencode" && !isNonEmptyString(job.prompt)) {
    fail("prompt", t("validation.promptRequired"));
  }
  if (job.runner === "shell" && !isNonEmptyString(job.command)) {
    fail("command", t("validation.commandRequired"));
  }
  if (job.prompt !== null && typeof job.prompt !== "string") {
    fail("prompt", t("validation.promptType"));
  }
  if (job.command !== null && typeof job.command !== "string") {
    fail("command", t("validation.commandType"));
  }

  if (!Array.isArray(job.args) || !job.args.every((arg) => typeof arg === "string")) {
    fail("args", t("validation.args"));
  }
  if (!isNonEmptyString(job.cwd)) {
    fail("cwd", t("validation.cwdRequired"));
  }
  if (job.model !== null && typeof job.model !== "string") {
    fail("model", t("validation.modelType"));
  }
  if (job.agent !== null && typeof job.agent !== "string") {
    fail("agent", t("validation.agentType"));
  }

  if (!SESSION_MODES.includes(job.sessionMode)) {
    fail("sessionMode", t("validation.sessionMode"));
  }
  if (job.sessionId !== null && typeof job.sessionId !== "string") {
    fail("sessionId", t("validation.sessionIdType"));
  }

  if (!SCHEDULE_KINDS.includes(job.scheduleKind)) {
    fail("scheduleKind", t("validation.scheduleKind"));
  }
  validateScheduleExpression(job.scheduleKind, job.scheduleExpr);

  if (!isValidTimezone(job.timezone)) {
    fail("timezone", t("validation.timezoneInvalid"));
  }

  if (!CATCH_UP_POLICIES.includes(job.catchUp)) {
    fail("catchUp", t("validation.catchUp"));
  }
  if (!Number.isInteger(job.catchUpLimit) || job.catchUpLimit < 1 || job.catchUpLimit > 100) {
    fail("catchUpLimit", t("validation.catchUpLimit"));
  }

  if (!OVERLAP_POLICIES.includes(job.overlap)) {
    fail("overlap", t("validation.overlap"));
  }
  if (!Number.isInteger(job.timeoutSec) || job.timeoutSec < 1 || job.timeoutSec > 86400) {
    fail("timeoutSec", t("validation.timeout"));
  }

  if (typeof job.notify !== "boolean") {
    fail("notify", t("validation.notify"));
  }
  if (!NOTIFY_ON_VALUES.includes(job.notifyOn)) {
    fail("notifyOn", t("validation.notifyOn"));
  }
  if (typeof job.enabled !== "boolean") {
    fail("enabled", t("validation.enabled"));
  }
}
