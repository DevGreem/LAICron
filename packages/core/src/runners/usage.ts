import type { RunUsage } from "../types.js";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Missing, non-numeric and non-finite values count as zero consumption. */
function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function recordOrEmpty(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function createdTime(message: JsonRecord): number | null {
  const created = recordOrEmpty(message["time"])["created"];

  return typeof created === "number" && Number.isFinite(created) ? created : null;
}

/**
 * Sums the consumption of the assistant messages created by a single run from
 * `opencode session export` output. Messages are filtered by `time.created` so
 * a continuous session only reports what this execution spent.
 *
 * Returns `null` when the export is not valid JSON or holds no assistant
 * message of the run; a valid run with no reported cost still returns zeros.
 */
export function parseSessionUsage(exportJson: string, startedAt: number): RunUsage | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(exportJson);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const messages = parsed["messages"];

  if (!Array.isArray(messages)) {
    return null;
  }

  const usage: RunUsage = {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  };
  let counted = 0;

  for (const message of messages) {
    if (!isRecord(message) || message["type"] !== "assistant") {
      continue;
    }

    const created = createdTime(message);

    if (created === null || created < startedAt) {
      continue;
    }

    counted += 1;

    const tokens = recordOrEmpty(message["tokens"]);
    const cache = recordOrEmpty(tokens["cache"]);

    usage.costUsd += numberOrZero(message["cost"]);
    usage.inputTokens += numberOrZero(tokens["input"]);
    usage.outputTokens += numberOrZero(tokens["output"]);
    usage.reasoningTokens += numberOrZero(tokens["reasoning"]);
    usage.cacheReadTokens += numberOrZero(cache["read"]);
    usage.cacheWriteTokens += numberOrZero(cache["write"]);
  }

  return counted > 0 ? usage : null;
}
