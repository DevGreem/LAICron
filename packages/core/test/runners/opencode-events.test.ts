import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseOpencodeEvents } from "../../src/runners/index.js";

const fixtureUrl = new URL("../fixtures/opencode-events.ndjson", import.meta.url);

describe("parseOpencodeEvents", () => {
  it("parses a real opencode NDJSON fixture", () => {
    const ndjson = readFileSync(fixtureUrl, "utf8");
    const { text, sessionId } = parseOpencodeEvents(ndjson);

    expect(text.trim()).toBe("ok");
    expect(sessionId).toMatch(/^ses_/);
  });

  it("concatenates text chunks and ignores garbage lines and unknown events", () => {
    const ndjson = [
      "",
      "not json at all",
      '{"type":"unknown_event","payload":{"foo":"bar"}}',
      '{"type":"text","sessionID":"ses_abc","part":{"type":"text","text":"hola "}}',
      '{"type":"text","part":{"text":"mundo"}}',
      '{"type":"message","content":"!"}',
      '{"broken":',
    ].join("\n");

    const { text, sessionId } = parseOpencodeEvents(ndjson);

    expect(text).toBe("hola mundo!");
    expect(sessionId).toBe("ses_abc");
  });

  it("does not duplicate text present in several fields of the same event", () => {
    const line = JSON.stringify({
      type: "text",
      text: "ok",
      part: { type: "text", text: "ok" },
    });

    expect(parseOpencodeEvents(line).text).toBe("ok");
  });

  it("returns empty output and no session for invalid input", () => {
    expect(parseOpencodeEvents("")).toEqual({ text: "", sessionId: null });
  });
});
