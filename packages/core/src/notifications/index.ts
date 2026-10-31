import type { Job, RunStatus } from "../types.js";

/** Default number of characters kept by {@link summarize}. */
const DEFAULT_MAX_CHARS = 140;

/**
 * Decides whether a finished run deserves a desktop notification.
 *
 * Non-terminal statuses (`queued`, `running`) and `skipped` runs never notify:
 * there is nothing worth telling the user about them.
 */
export function shouldNotify(job: Pick<Job, "notify" | "notifyOn">, status: RunStatus): boolean {
  if (!job.notify) {
    return false;
  }

  if (status === "queued" || status === "running" || status === "skipped") {
    return false;
  }

  switch (job.notifyOn) {
    case "always":
      return true;
    case "failure":
      return status === "failed" || status === "timeout" || status === "interrupted";
    case "success":
      return status === "success";
  }
}

/**
 * Flattens a text into a single line and truncates it so it fits in a desktop
 * notification.
 *
 * Whitespace runs collapse to a single space and the result is trimmed. When
 * the text is too long it is cut at a word boundary (if one exists before the
 * limit) and an ellipsis is appended, so the result is at most `maxChars + 1`
 * characters long. Never throws: blank input yields an empty string.
 */
export function summarize(text: string, maxChars: number = DEFAULT_MAX_CHARS): string {
  const collapsed = text.replace(/\s+/gu, " ").trim();
  if (collapsed.length === 0) {
    return "";
  }

  const limit = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : DEFAULT_MAX_CHARS;
  if (collapsed.length <= limit) {
    return collapsed;
  }

  const clipped = collapsed.slice(0, limit);
  const lastSpace = clipped.lastIndexOf(" ");
  const stem = lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped;

  return `${stem}…`;
}
