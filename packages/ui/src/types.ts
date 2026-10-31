/** Domain types mirroring the daemon API (v1.1, camelCase JSON). */

export type RunnerKind = "opencode" | "shell";
export type ScheduleKind = "cron" | "interval" | "once";
/** Per-cron MCP override. `inherit` is never stored: an absent key means inherited. */
export type McpState = "on" | "off";
export type CatchUpPolicy = "none" | "once" | "all";
export type OverlapPolicy = "skip" | "queue" | "kill";
export type SessionMode = "independent" | "continuous";
export type NotifyOn = "always" | "failure" | "success";
export type RunTrigger = "scheduled" | "catch_up" | "manual";
export type RunStatus =
  "queued" | "running" | "success" | "failed" | "timeout" | "skipped" | "interrupted";

export interface Job {
  id: string;
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
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastStatus: RunStatus | null;
  createdAt: number;
  updatedAt: number;
}

export interface Run {
  id: string;
  jobId: string;
  trigger: RunTrigger;
  status: RunStatus;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  exitCode: number | null;
  output: string | null;
  error: string | null;
  sessionId: string | null;
  missedCount: number;
  notificationDelivered: boolean | null;
}

export interface Message {
  id: string;
  jobId: string;
  runId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

export interface Health {
  status: string;
  version: string;
  uptimeMs: number;
  heartbeatAt: number | null;
}

/** Body accepted by `POST /api/jobs` and `PATCH /api/jobs/:id`. */
export interface JobInput {
  name: string;
  enabled: boolean;
  runner: RunnerKind;
  prompt: string | null;
  command: string | null;
  args: string[];
  cwd?: string;
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
  mcpOverrides?: Record<string, McpState>;
}

/** A model exposed by `opencode models`, enriched with its variants. */
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

/** An MCP server exposed by `opencode mcp list` for a given working directory. */
export interface OpencodeMcpOption {
  name: string;
  enabled: boolean;
  status: string;
}

/** Catalog consumed by the job form to render model, variant, agent and MCP lists. */
export interface OpencodeOptions {
  available: boolean;
  reason: string | null;
  models: OpencodeModelOption[];
  agents: OpencodeAgentOption[];
  mcps: OpencodeMcpOption[];
}

export interface JobListResponse {
  jobs: Job[];
}

export interface JobResponse {
  job: Job;
}

export interface RunResponse {
  run: Run;
}

export interface RunPage {
  runs: Run[];
  total: number;
  limit: number;
  offset: number;
}

export interface MessagePage {
  messages: Message[];
  total: number;
  limit: number;
  offset: number;
}
