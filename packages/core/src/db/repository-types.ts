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

/** Fields accepted when creating a job. Server-managed fields are excluded. */
export interface CreateJobInput {
  name: string;
  enabled?: boolean;
  runner: RunnerKind;
  prompt?: string | null;
  command?: string | null;
  args?: string[];
  cwd?: string;
  model?: string | null;
  agent?: string | null;
  sessionMode?: SessionMode;
  sessionId?: string | null;
  scheduleKind: ScheduleKind;
  scheduleExpr: string;
  timezone?: string;
  catchUp?: CatchUpPolicy;
  catchUpLimit?: number;
  overlap?: OverlapPolicy;
  timeoutSec?: number;
  notify?: boolean;
  notifyOn?: NotifyOn;
  mcpOverrides?: Record<string, McpState>;
}

/** Partial patch for an existing job; the merged result is validated. */
export type UpdateJobInput = Partial<CreateJobInput>;

export interface JobRepository {
  create(input: CreateJobInput): Job;
  get(id: string): Job | null;
  list(filter?: { enabled?: boolean }): Job[];
  update(id: string, patch: UpdateJobInput): Job;
  remove(id: string): void;
  dueBefore(nowMs: number): Job[];
  setNextRun(id: string, nextRunAt: number | null): void;
  recordOutcome(id: string, status: RunStatus, atMs: number): void;
}

export interface RunRepository {
  create(input: {
    jobId: string;
    trigger: RunTrigger;
    status: RunStatus;
    missedCount?: number;
  }): Run;
  get(id: string): Run | null;
  markStarted(id: string, atMs: number): Run;
  finish(
    id: string,
    result: {
      status: RunStatus;
      finishedAt: number;
      durationMs: number;
      exitCode: number | null;
      output: string | null;
      error: string | null;
      sessionId: string | null;
      notificationDelivered: boolean | null;
    },
  ): Run;
  listByJob(jobId: string, opts: { limit: number; offset: number }): Run[];
  countByJob(jobId: string): number;
  activeByJob(jobId: string): Run | null;
  markRunningAsInterrupted(nowMs: number): number;
  pruneForJob(jobId: string, opts: { maxAgeMs: number; maxCount: number }): number;
}

export interface MessageRepository {
  create(input: {
    jobId: string;
    runId: string;
    role: "user" | "assistant";
    content: string;
    createdAt: number;
  }): Message;
  listByJob(jobId: string, opts: { limit: number; offset: number }): Message[];
  listByRun(runId: string): Message[];
  countByJob(jobId: string): number;
}

export interface MetaRepository {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export interface Repositories {
  jobs: JobRepository;
  runs: RunRepository;
  messages: MessageRepository;
  meta: MetaRepository;
}
