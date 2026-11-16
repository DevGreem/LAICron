import { describe, expect, it } from "vitest";

import { parseSessionUsage } from "../../src/runners/usage.js";

const STARTED_AT = 1_700_000_000_000;

interface AssistantFields {
  cost?: unknown;
  tokens?: unknown;
}

function assistant(created: number, fields: AssistantFields = {}): Record<string, unknown> {
  return {
    type: "assistant",
    time: { created },
    cost: fields.cost ?? 0,
    tokens: fields.tokens ?? {},
  };
}

function exportJson(messages: unknown[]): string {
  return JSON.stringify({ info: { id: "ses_test" }, messages });
}

describe("parseSessionUsage", () => {
  it("ignores assistant messages created before the run started", () => {
    const before = assistant(STARTED_AT - 1, {
      cost: 99,
      tokens: {
        input: 9_999,
        output: 9_999,
        reasoning: 9_999,
        cache: { read: 9_999, write: 9_999 },
      },
    });
    const during = assistant(STARTED_AT, {
      cost: 0.25,
      tokens: { input: 10, output: 20, reasoning: 3, cache: { read: 40, write: 5 } },
    });

    expect(parseSessionUsage(exportJson([before, during]), STARTED_AT)).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      reasoningTokens: 3,
      cacheReadTokens: 40,
      cacheWriteTokens: 5,
      costUsd: 0.25,
    });
  });

  it("sums every assistant message of the run", () => {
    const first = assistant(STARTED_AT + 1, {
      cost: 0.125,
      tokens: { input: 100, output: 20, reasoning: 1, cache: { read: 1_000, write: 10 } },
    });
    const second = assistant(STARTED_AT + 2, {
      cost: 0.25,
      tokens: { input: 200, output: 40, reasoning: 2, cache: { read: 2_000, write: 20 } },
    });

    expect(parseSessionUsage(exportJson([first, second]), STARTED_AT)).toEqual({
      inputTokens: 300,
      outputTokens: 60,
      reasoningTokens: 3,
      cacheReadTokens: 3_000,
      cacheWriteTokens: 30,
      costUsd: 0.375,
    });
  });

  it("returns null for invalid JSON, empty exports and non-assistant messages", () => {
    expect(parseSessionUsage("{ not json", STARTED_AT)).toBeNull();
    expect(parseSessionUsage("", STARTED_AT)).toBeNull();
    expect(parseSessionUsage(exportJson([]), STARTED_AT)).toBeNull();
    expect(
      parseSessionUsage(
        exportJson([
          { type: "user", time: { created: STARTED_AT + 1 }, cost: 5, tokens: { input: 100 } },
          { type: "idle", time: { created: STARTED_AT + 2 } },
        ]),
        STARTED_AT,
      ),
    ).toBeNull();
  });

  it("treats missing or non-numeric fields as zero without throwing", () => {
    const message = assistant(STARTED_AT + 1, {
      cost: "free",
      tokens: { input: 7, output: null, cache: "none" },
    });

    expect(parseSessionUsage(exportJson([message]), STARTED_AT)).toEqual({
      inputTokens: 7,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    });
  });
});
