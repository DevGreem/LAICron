import type { IncomingMessage, ServerResponse } from "node:http";

import { NotFoundError, ValidationError } from "@laicron/core/db";
import { ScheduleError } from "@laicron/core/schedule";

/** Hard limit for request bodies: anything bigger is rejected before parsing. */
export const MAX_BODY_BYTES = 1024 * 1024;

export type ApiErrorCode = "unauthorized" | "not_found" | "validation_error" | "internal_error";

interface ErrorPayload {
  error: {
    code: ApiErrorCode;
    message: string;
    field?: string;
  };
}

/** The request body is not valid JSON (or is empty). */
export class InvalidJsonError extends Error {
  constructor(message = "El cuerpo de la petición no es JSON válido.") {
    super(message);
    this.name = "InvalidJsonError";
  }
}

/** The request body exceeded {@link MAX_BODY_BYTES}. */
export class PayloadTooLargeError extends Error {
  constructor(message = "El cuerpo de la petición supera 1 MB.") {
    super(message);
    this.name = "PayloadTooLargeError";
  }
}

/** A request field failed a validation performed by the API layer itself. */
export class RequestValidationError extends Error {
  readonly field: string | undefined;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "RequestValidationError";
    this.field = field;
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function sendNoContent(res: ServerResponse): void {
  res.writeHead(204);
  res.end();
}

export function sendError(
  res: ServerResponse,
  status: number,
  code: ApiErrorCode,
  message: string,
  field?: string,
): void {
  const payload: ErrorPayload = { error: { code, message } };
  if (field !== undefined) {
    payload.error.field = field;
  }
  sendJson(res, status, payload);
}

/**
 * Maps a known error to an HTTP response. Returns false when the error is not
 * part of the public contract and must become a generic 500.
 */
export function sendKnownError(res: ServerResponse, error: unknown): boolean {
  if (error instanceof ScheduleError) {
    sendError(res, 400, "validation_error", error.message, error.field);
    return true;
  }
  if (error instanceof ValidationError) {
    sendError(res, 400, "validation_error", error.message, error.field);
    return true;
  }
  if (error instanceof RequestValidationError) {
    sendError(res, 400, "validation_error", error.message, error.field);
    return true;
  }
  if (error instanceof InvalidJsonError || error instanceof PayloadTooLargeError) {
    sendError(res, 400, "validation_error", error.message);
    return true;
  }
  if (error instanceof NotFoundError) {
    sendError(res, 404, "not_found", error.message);
    return true;
  }
  return false;
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads and parses a JSON request body while enforcing the size limit. The
 * stream is always drained so the response can be written even when the body
 * is rejected halfway through.
 */
export function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const declaredLength = Number(req.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    req.resume();
    return Promise.reject(new PayloadTooLargeError());
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;

    req.on("data", (chunk: Buffer) => {
      if (tooLarge) {
        return;
      }
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (tooLarge) {
        reject(new PayloadTooLargeError());
        return;
      }
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.trim().length === 0) {
        reject(new InvalidJsonError());
        return;
      }
      try {
        resolve(JSON.parse(text) as unknown);
      } catch {
        reject(new InvalidJsonError());
      }
    });

    req.on("error", reject);
  });
}
