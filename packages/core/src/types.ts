export type RunnerKind = "opencode" | "shell";
export type ScheduleKind = "cron" | "interval" | "once";
export type CatchUpPolicy = "none" | "once" | "all";
export type OverlapPolicy = "skip" | "queue" | "kill";
export type SessionMode = "independent" | "continuous";
export type NotifyOn = "always" | "failure" | "success";
/** Per-cron MCP override. `inherit` is never stored: an absent key means inherited. */
export type McpState = "on" | "off";
export type RunTrigger = "scheduled" | "catch_up" | "manual";
export type RunStatus =
  | "queued" | "running" | "success" | "failed" | "timeout" | "skipped" | "interrupted";
export type RunOutcomeStatus = "success" | "failed" | "timeout" | "interrupted";

export interface Job {
  id: string; name: string; enabled: boolean;
  runner: RunnerKind; prompt: string | null; command: string | null;
  args: string[]; cwd: string; model: string | null; agent: string | null;
  sessionMode: SessionMode; sessionId: string | null;
  scheduleKind: ScheduleKind; scheduleExpr: string; timezone: string;
  catchUp: CatchUpPolicy; catchUpLimit: number; overlap: OverlapPolicy;
  timeoutSec: number; notify: boolean; notifyOn: NotifyOn;
  mcpOverrides: Record<string, McpState>;
  nextRunAt: number | null; lastRunAt: number | null; lastStatus: RunStatus | null;
  createdAt: number; updatedAt: number;
}

export interface Run {
  id: string; jobId: string; trigger: RunTrigger; status: RunStatus;
  startedAt: number | null; finishedAt: number | null; durationMs: number | null;
  exitCode: number | null; output: string | null; error: string | null;
  sessionId: string | null; missedCount: number; notificationDelivered: boolean | null;
  // Token and cost consumption. `null` means "no data", which is not the same as zero.
  inputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null;
  cacheReadTokens: number | null; cacheWriteTokens: number | null; costUsd: number | null;
}

/** Consumption reported by a single execution. */
export interface RunUsage {
  inputTokens: number; outputTokens: number; reasoningTokens: number;
  cacheReadTokens: number; cacheWriteTokens: number; costUsd: number;
}

/** Aggregated consumption of every execution of a job. */
export interface JobUsage {
  runs: number; runsWithUsage: number;
  inputTokens: number; outputTokens: number; reasoningTokens: number;
  cacheReadTokens: number; cacheWriteTokens: number; costUsd: number;
}

export interface Message {
  id: string; jobId: string; runId: string;
  role: "user" | "assistant"; content: string; createdAt: number;
}

export interface RunResult {
  status: RunOutcomeStatus; exitCode: number | null; output: string;
  error: string | null; sessionId: string | null; durationMs: number;
  /** Optional so runners that cannot read consumption stay valid. */
  usage?: RunUsage | null;
}

export interface Runner {
  readonly kind: RunnerKind;
  run(job: Job, signal: AbortSignal): Promise<RunResult>;
}
export interface RunnerRegistry { get(kind: RunnerKind): Runner; }

export interface NotificationPayload {
  jobName: string; status: RunStatus; durationMs: number;
  summary: string; error: string | null;
}
export interface Notifier { notify(payload: NotificationPayload): Promise<boolean>; }

export type EngineEvent =
  | { type: "job.created"; job: Job }
  | { type: "job.updated"; job: Job }
  | { type: "job.deleted"; jobId: string }
  | { type: "run.queued"; run: Run }
  | { type: "run.started"; run: Run }
  | { type: "run.finished"; run: Run }
  | { type: "heartbeat"; at: number };

export interface Engine {
  dispatch(job: Job, trigger: RunTrigger, opts?: { missedCount?: number }): Promise<Run | null>;
  runNow(jobId: string): Promise<Run>;
  cancelAll(): Promise<void>;
  onEvent(listener: (event: EngineEvent) => void): () => void;
}

export interface Clock {
  start(): Promise<void>;
  stop(): Promise<void>;
  lastTickAt(): number | null;
}
