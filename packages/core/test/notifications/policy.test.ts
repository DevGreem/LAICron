import { describe, expect, it } from "vitest";

import { shouldNotify, summarize } from "../../src/notifications/index.js";
import type { NotifyOn, RunStatus } from "../../src/types.js";

const STATUSES: RunStatus[] = [
  "queued",
  "running",
  "success",
  "failed",
  "timeout",
  "skipped",
  "interrupted",
];

/** Statuses that may raise a notification once `notify` is enabled. */
const ALLOWED: Record<NotifyOn, RunStatus[]> = {
  always: ["success", "failed", "timeout", "interrupted"],
  failure: ["failed", "timeout", "interrupted"],
  success: ["success"],
};

const POLICIES: NotifyOn[] = ["always", "failure", "success"];

describe("shouldNotify", () => {
  it("never notifies when the job has notifications disabled", () => {
    for (const notifyOn of POLICIES) {
      for (const status of STATUSES) {
        expect(shouldNotify({ notify: false, notifyOn }, status), `${notifyOn}/${status}`).toBe(
          false,
        );
      }
    }
  });

  it("follows notifyOn for every status when notifications are enabled", () => {
    for (const notifyOn of POLICIES) {
      for (const status of STATUSES) {
        expect(shouldNotify({ notify: true, notifyOn }, status), `${notifyOn}/${status}`).toBe(
          ALLOWED[notifyOn].includes(status),
        );
      }
    }
  });

  it("notifies interrupted runs only under failure and always", () => {
    expect(shouldNotify({ notify: true, notifyOn: "failure" }, "interrupted")).toBe(true);
    expect(shouldNotify({ notify: true, notifyOn: "always" }, "interrupted")).toBe(true);
    expect(shouldNotify({ notify: true, notifyOn: "success" }, "interrupted")).toBe(false);
  });

  it("never notifies for in-flight or skipped statuses", () => {
    for (const notifyOn of POLICIES) {
      for (const status of ["queued", "running", "skipped"] as RunStatus[]) {
        expect(shouldNotify({ notify: true, notifyOn }, status), `${notifyOn}/${status}`).toBe(
          false,
        );
      }
    }
  });
});

describe("summarize", () => {
  it("leaves short text untouched", () => {
    expect(summarize("Todo correcto")).toBe("Todo correcto");
  });

  it("collapses spaces and line breaks into a single line", () => {
    expect(summarize("  hola\n\n  mundo\tcon   espacios ")).toBe("hola mundo con espacios");
  });

  it("returns an empty string for blank input", () => {
    expect(summarize("")).toBe("");
    expect(summarize("   \n\t  ")).toBe("");
  });

  it("truncates long text by words and appends an ellipsis", () => {
    const text = "Palabra ".repeat(40).trim();
    const summary = summarize(text, 60);

    expect(summary.endsWith("…")).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(61);
    expect(summary.slice(0, -1).split(" ")).toEqual(Array<string>(7).fill("Palabra"));
  });

  it("uses 140 characters by default", () => {
    const summary = summarize("x".repeat(500));

    expect(summary.length).toBe(141);
  });

  it("keeps the limit when a single long word has no boundary", () => {
    const summary = summarize("a".repeat(300), 20);

    expect(summary).toBe(`${"a".repeat(20)}…`);
  });

  it("does not throw on degenerate limits", () => {
    expect(() => summarize("hola mundo", 0)).not.toThrow();
    expect(summarize("hola mundo", 0)).toBe("…");
  });
});
