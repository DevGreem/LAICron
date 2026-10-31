import type { IncomingMessage, ServerResponse } from "node:http";

import type { Engine, Job, ScheduleKind } from "@laicron/core";
import {
  NotFoundError,
  type CreateJobInput,
  type JobRepository,
  type MessageRepository,
  type RunRepository,
  type UpdateJobInput,
} from "@laicron/core/db";
import { computeNextRun, validateSchedule } from "@laicron/core/schedule";

import {
  RequestValidationError,
  isJsonObject,
  readJsonBody,
  sendJson,
  sendNoContent,
} from "./errors.js";

const DEFAULT_RUNS_LIMIT = 20;
const DEFAULT_MESSAGES_LIMIT = 100;
const MAX_PAGE_LIMIT = 200;

/** Repositories and collaborators needed by the job routes. */
export interface JobRouteDeps {
  engine: Engine;
  jobs: JobRepository;
  runs: RunRepository;
  messages: MessageRepository;
  now: () => number;
}

function systemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
}

function requireJob(deps: JobRouteDeps, id: string): Job {
  const job = deps.jobs.get(id);
  if (job === null) {
    throw new NotFoundError(`No se encontró el cron ${id}.`);
  }
  return job;
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readJsonBody(req);
  if (!isJsonObject(body)) {
    throw new RequestValidationError("El cuerpo de la petición debe ser un objeto JSON.");
  }
  return body;
}

/**
 * Validates the schedule part of a create/update body. Missing or wrongly
 * typed fields are left to the repository so every error keeps its own field.
 */
function assertSchedule(
  kind: unknown,
  expr: unknown,
  timezone: unknown,
  fallbackTimezone: string,
): void {
  if (typeof kind !== "string" || typeof expr !== "string") {
    return;
  }

  let resolvedTimezone: string;
  if (timezone === undefined || timezone === null) {
    resolvedTimezone = fallbackTimezone;
  } else if (typeof timezone === "string") {
    resolvedTimezone = timezone;
  } else {
    // Empty string makes ScheduleError point at the timezone field.
    resolvedTimezone = "";
  }

  validateSchedule(kind as ScheduleKind, expr, resolvedTimezone);
}

/** Recomputes `nextRunAt` for the current state and returns the stored job. */
function withComputedNextRun(deps: JobRouteDeps, job: Job): Job {
  const nextRunAt = job.enabled ? computeNextRun(job, deps.now()) : null;
  deps.jobs.setNextRun(job.id, nextRunAt);
  return requireJob(deps, job.id);
}

async function createJob(
  deps: JobRouteDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await readBody(req);
  assertSchedule(body["scheduleKind"], body["scheduleExpr"], body["timezone"], systemTimezone());

  const created = deps.jobs.create(body as unknown as CreateJobInput);
  const job = withComputedNextRun(deps, created);
  sendJson(res, 201, { job });
}

async function updateJob(
  deps: JobRouteDeps,
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
): Promise<void> {
  const existing = requireJob(deps, id);
  const body = await readBody(req);

  const touchesSchedule = "scheduleKind" in body || "scheduleExpr" in body || "timezone" in body;
  assertSchedule(
    body["scheduleKind"] ?? existing.scheduleKind,
    body["scheduleExpr"] ?? existing.scheduleExpr,
    body["timezone"] ?? existing.timezone,
    existing.timezone,
  );

  const updated = deps.jobs.update(id, body as unknown as UpdateJobInput);
  const shouldRecompute =
    !updated.enabled || touchesSchedule || "enabled" in body || updated.nextRunAt === null;
  const job = shouldRecompute ? withComputedNextRun(deps, updated) : updated;
  sendJson(res, 200, { job });
}

function pauseJob(deps: JobRouteDeps, res: ServerResponse, id: string): void {
  requireJob(deps, id);
  deps.jobs.update(id, { enabled: false });
  deps.jobs.setNextRun(id, null);
  sendJson(res, 200, { job: requireJob(deps, id) });
}

function resumeJob(deps: JobRouteDeps, res: ServerResponse, id: string): void {
  requireJob(deps, id);
  const updated = deps.jobs.update(id, { enabled: true });
  deps.jobs.setNextRun(id, computeNextRun(updated, deps.now()));
  sendJson(res, 200, { job: requireJob(deps, id) });
}

async function runJob(deps: JobRouteDeps, res: ServerResponse, id: string): Promise<void> {
  requireJob(deps, id);
  const run = await deps.engine.runNow(id);
  sendJson(res, 202, { run });
}

function parseIntegerParameter(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
  field: string,
): number {
  if (raw === null) {
    return fallback;
  }
  if (!/^\d+$/.test(raw)) {
    throw new RequestValidationError(`El parámetro "${field}" debe ser un entero.`, field);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RequestValidationError(
      `El parámetro "${field}" debe estar entre ${min} y ${max}.`,
      field,
    );
  }
  return value;
}

function parsePagination(url: URL, defaultLimit: number): { limit: number; offset: number } {
  return {
    limit: parseIntegerParameter(
      url.searchParams.get("limit"),
      defaultLimit,
      1,
      MAX_PAGE_LIMIT,
      "limit",
    ),
    offset: parseIntegerParameter(
      url.searchParams.get("offset"),
      0,
      0,
      Number.MAX_SAFE_INTEGER,
      "offset",
    ),
  };
}

function listRuns(deps: JobRouteDeps, res: ServerResponse, url: URL, id: string): void {
  requireJob(deps, id);
  const { limit, offset } = parsePagination(url, DEFAULT_RUNS_LIMIT);
  const runs = deps.runs.listByJob(id, { limit, offset });
  const total = deps.runs.countByJob(id);
  sendJson(res, 200, { runs, total, limit, offset });
}

function listMessages(deps: JobRouteDeps, res: ServerResponse, url: URL, id: string): void {
  requireJob(deps, id);
  const { limit, offset } = parsePagination(url, DEFAULT_MESSAGES_LIMIT);
  const messages = deps.messages.listByJob(id, { limit, offset });
  const total = deps.messages.countByJob(id);
  sendJson(res, 200, { messages, total, limit, offset });
}

function decodeJobId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new RequestValidationError("El identificador del cron no es válido.", "id");
  }
}

/**
 * Dispatches `/api/jobs...` routes. Returns false when the path or method is
 * not part of the job API, so the caller can answer with a generic 404.
 */
export async function handleJobsRoute(
  deps: JobRouteDeps,
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  url: URL,
  segments: string[],
): Promise<boolean> {
  if (segments[0] !== "api" || segments[1] !== "jobs") {
    return false;
  }

  if (segments.length === 2) {
    if (method === "GET") {
      sendJson(res, 200, { jobs: deps.jobs.list() });
      return true;
    }
    if (method === "POST") {
      await createJob(deps, req, res);
      return true;
    }
    return false;
  }

  const rawId = segments[2];
  if (rawId === undefined) {
    return false;
  }
  const id = decodeJobId(rawId);

  if (segments.length === 3) {
    if (method === "GET") {
      sendJson(res, 200, { job: requireJob(deps, id) });
      return true;
    }
    if (method === "PATCH") {
      await updateJob(deps, req, res, id);
      return true;
    }
    if (method === "DELETE") {
      requireJob(deps, id);
      deps.jobs.remove(id);
      sendNoContent(res);
      return true;
    }
    return false;
  }

  if (segments.length !== 4) {
    return false;
  }

  const action = segments[3];
  switch (action) {
    case "pause":
      if (method !== "POST") {
        return false;
      }
      pauseJob(deps, res, id);
      return true;
    case "resume":
      if (method !== "POST") {
        return false;
      }
      resumeJob(deps, res, id);
      return true;
    case "run":
      if (method !== "POST") {
        return false;
      }
      await runJob(deps, res, id);
      return true;
    case "runs":
      if (method !== "GET") {
        return false;
      }
      listRuns(deps, res, url, id);
      return true;
    case "messages":
      if (method !== "GET") {
        return false;
      }
      listMessages(deps, res, url, id);
      return true;
    default:
      return false;
  }
}
