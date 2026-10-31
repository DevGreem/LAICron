import { describe, expect, it } from "vitest";

import { createOpencodeRunner } from "../../src/runners/index.js";
import { makeJob } from "./job.js";

// Opt-in only: this test spends real time and tokens against the local opencode.
// Run it with: LAICRON_SMOKE_OPENCODE=1 pnpm exec vitest run packages/core/test/runners
const smokeEnabled = process.env.LAICRON_SMOKE_OPENCODE === "1";

describe.skipIf(!smokeEnabled)("opencode runner (real smoke)", () => {
  it("runs a short prompt against the real opencode binary", async () => {
    const result = await createOpencodeRunner().run(
      makeJob({
        runner: "opencode",
        prompt: "Responde solo con la palabra ok",
        cwd: process.cwd(),
        timeoutSec: 120,
      }),
      new AbortController().signal,
    );

    expect(result.status).toBe("success");
    expect(result.exitCode).toBe(0);
    expect(result.output.trim().length).toBeGreaterThan(0);
    expect(result.error).toBeNull();
    expect(result.sessionId).toMatch(/^ses_/);
  }, 130_000);
});
