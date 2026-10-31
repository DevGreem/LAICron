type JsonRecord = Record<string, unknown>;

export interface ParsedOpencodeEvents {
  text: string;
  sessionId: string | null;
  lastError: string | null;
}

const SESSION_KEYS = ["sessionID", "sessionId", "session_id"] as const;

const TEXT_PATHS = ["text", "part.text", "content", "part.content"] as const;

const ERROR_PATHS = [
  "error.data.message",
  "error.message",
  "error",
  "part.text",
  "part.error",
  "message",
  "text",
  "content",
] as const;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPath(record: JsonRecord, path: string): unknown {
  let current: unknown = record;

  for (const key of path.split(".")) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }

  return current;
}

function firstString(record: JsonRecord, paths: readonly string[]): string | null {
  for (const path of paths) {
    const value = readPath(record, path);

    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

function extractSessionId(record: JsonRecord): string | null {
  const direct = firstString(record, SESSION_KEYS);

  if (direct !== null) {
    return direct;
  }

  for (const key of SESSION_KEYS) {
    const value = readPath(record, `part.${key}`);

    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

function isErrorEvent(record: JsonRecord): boolean {
  const type = typeof record.type === "string" ? record.type.toLowerCase() : "";
  const partType = readPath(record, "part.type");
  const normalizedPartType = typeof partType === "string" ? partType.toLowerCase() : "";

  return (
    type.includes("error") || normalizedPartType.includes("error") || record.error !== undefined
  );
}

function extractErrorText(record: JsonRecord): string | null {
  const message = firstString(record, ERROR_PATHS);

  if (message !== null) {
    return message;
  }

  const error = record.error;

  if (error !== undefined) {
    try {
      return JSON.stringify(error);
    } catch {
      return null;
    }
  }

  return null;
}

function extractTextChunks(record: JsonRecord): string[] {
  const chunks: string[] = [];

  for (const path of TEXT_PATHS) {
    const value = readPath(record, path);

    if (typeof value !== "string" || value.length === 0) {
      continue;
    }
    if (!chunks.includes(value)) {
      chunks.push(value);
    }
  }

  return chunks;
}

/**
 * Tolerant NDJSON parser for `opencode run --format json`. Invalid lines and
 * unknown event shapes are skipped; assistant text and the session id are
 * collected from whichever events carry them.
 */
export function parseOpencodeStream(ndjson: string): ParsedOpencodeEvents {
  let text = "";
  let sessionId: string | null = null;
  let lastError: string | null = null;

  for (const rawLine of ndjson.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line.length === 0) {
      continue;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (!isRecord(parsed)) {
      continue;
    }

    if (sessionId === null) {
      sessionId = extractSessionId(parsed);
    }

    if (isErrorEvent(parsed)) {
      const errorText = extractErrorText(parsed);

      if (errorText !== null) {
        lastError = errorText;
      }
      continue;
    }

    for (const chunk of extractTextChunks(parsed)) {
      text += chunk;
    }
  }

  return { text, sessionId, lastError };
}

export function parseOpencodeEvents(ndjson: string): {
  text: string;
  sessionId: string | null;
} {
  const { text, sessionId } = parseOpencodeStream(ndjson);

  return { text, sessionId };
}
