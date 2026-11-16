import type {
  CatchUpPolicy,
  Job,
  McpState,
  Message,
  NotifyOn,
  OverlapPolicy,
  Run,
  RunnerKind,
  RunStatus,
  RunTrigger,
  ScheduleKind,
  SessionMode,
} from "../types.js";

/** A row as returned by `node:sqlite` (already unwrapped from its SQL output wrapper). */
export type Row = Record<string, unknown>;

export function asString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

export function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === "string" ? value : String(value);
}

export function asNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return asNumber(value);
}

export function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === null || value === undefined) {
    return fallback;
  }
  return asNumber(value) !== 0;
}

export function asNullableBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) {
    return null;
  }
  return asNumber(value) !== 0;
}

function parseArgs(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((item): item is string => typeof item === "string")) {
      return parsed;
    }
  } catch {
    // Corrupt JSON should not make the whole list unusable.
  }
  return [];
}

function parseMcpOverrides(value: unknown): Record<string, McpState> {
  if (typeof value !== "string") {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    // Corrupt JSON means "everything inherited" instead of breaking the whole job.
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  const overrides: Record<string, McpState> = {};
  for (const [key, state] of Object.entries(parsed as Record<string, unknown>)) {
    if (key.trim().length === 0 || (state !== "on" && state !== "off")) {
      // Unknown values are dropped along with the rest: a partial override set would silently
      // change behaviour, so an unreadable row falls back to fully inherited.
      return {};
    }
    overrides[key] = state;
  }
  return overrides;
}

export function toJob(row: Row): Job {
  return {
    id: asString(row["id"]),
    name: asString(row["name"]),
    enabled: asBoolean(row["enabled"], true),
    runner: asString(row["runner"]) as RunnerKind,
    prompt: asNullableString(row["prompt"]),
    command: asNullableString(row["command"]),
    args: parseArgs(row["args_json"]),
    cwd: asString(row["cwd"]),
    model: asNullableString(row["model"]),
    agent: asNullableString(row["agent"]),
    sessionMode: asString(row["session_mode"]) as SessionMode,
    sessionId: asNullableString(row["session_id"]),
    scheduleKind: asString(row["schedule_kind"]) as ScheduleKind,
    scheduleExpr: asString(row["schedule_expr"]),
    timezone: asString(row["timezone"]),
    catchUp: asString(row["catch_up"]) as CatchUpPolicy,
    catchUpLimit: asNumber(row["catch_up_limit"]),
    overlap: asString(row["overlap"]) as OverlapPolicy,
    timeoutSec: asNumber(row["timeout_sec"]),
    notify: asBoolean(row["notify"], true),
    notifyOn: asString(row["notify_on"]) as NotifyOn,
    mcpOverrides: parseMcpOverrides(row["mcp_overrides"]),
    nextRunAt: asNullableNumber(row["next_run_at"]),
    lastRunAt: asNullableNumber(row["last_run_at"]),
    lastStatus: asNullableString(row["last_status"]) as RunStatus | null,
    createdAt: asNumber(row["created_at"]),
    updatedAt: asNumber(row["updated_at"]),
  };
}

export function toRun(row: Row): Run {
  return {
    id: asString(row["id"]),
    jobId: asString(row["job_id"]),
    trigger: asString(row["trigger"]) as RunTrigger,
    status: asString(row["status"]) as RunStatus,
    startedAt: asNullableNumber(row["started_at"]),
    finishedAt: asNullableNumber(row["finished_at"]),
    durationMs: asNullableNumber(row["duration_ms"]),
    exitCode: asNullableNumber(row["exit_code"]),
    output: asNullableString(row["output"]),
    error: asNullableString(row["error"]),
    sessionId: asNullableString(row["session_id"]),
    missedCount: asNumber(row["missed_count"]),
    notificationDelivered: asNullableBoolean(row["notification_delivered"]),
    inputTokens: asNullableNumber(row["input_tokens"]),
    outputTokens: asNullableNumber(row["output_tokens"]),
    reasoningTokens: asNullableNumber(row["reasoning_tokens"]),
    cacheReadTokens: asNullableNumber(row["cache_read_tokens"]),
    cacheWriteTokens: asNullableNumber(row["cache_write_tokens"]),
    costUsd: asNullableNumber(row["cost_usd"]),
  };
}

export function toMessage(row: Row): Message {
  return {
    id: asString(row["id"]),
    jobId: asString(row["job_id"]),
    runId: asString(row["run_id"]),
    role: asString(row["role"]) === "assistant" ? "assistant" : "user",
    content: asString(row["content"]),
    createdAt: asNumber(row["created_at"]),
  };
}
