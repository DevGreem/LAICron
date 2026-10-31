import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { createOpencodeRunner } from "../../src/runners/index.js";
import { makeJob } from "./job.js";

const fakeBinDir = mkdtempSync(join(tmpdir(), "laicron-fake-opencode-"));
const fakeBin = join(fakeBinDir, "opencode");

// Fake binary: emits the received arguments as one NDJSON text event so the
// test can assert the exact argument order without a real opencode install.
writeFileSync(fakeBin, '#!/bin/sh\nprintf \'{"type":"text","part":{"text":"%s"}}\\n\' "$*"\n');
chmodSync(fakeBin, 0o755);

afterAll(() => {
  rmSync(fakeBinDir, { recursive: true, force: true });
});

describe("opencode runner args", () => {
  it("passes the job args before the prompt, which stays last", async () => {
    const runner = createOpencodeRunner({
      ...process.env,
      PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
    });

    const result = await runner.run(
      makeJob({ runner: "opencode", args: ["--foo", "bar"], prompt: "hola" }),
      new AbortController().signal,
    );

    expect(result.status).toBe("success");
    expect(result.output).toContain("--foo bar hola");

    const received = result.output.trim().split(/\s+/);

    expect(received[received.length - 1]).toBe("hola");
  });
});
