import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { NotificationPayload, Notifier } from "@laicron/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createNotifier } from "../src/notifier.js";

const SUCCESS: NotificationPayload = {
  jobName: "Resumen diario",
  status: "success",
  durationMs: 12_345,
  summary: "Todo listo",
  error: null,
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "laicron-notifier-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Writes an executable shell script that stands in for `notify-send`. */
async function writeScript(name: string, body: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, `#!/bin/sh\n${body}\n`, "utf8");
  await chmod(path, 0o755);
  return path;
}

async function readLines(path: string): Promise<string[]> {
  const content = await readFile(path, "utf8");
  return content.replace(/\n$/u, "").split("\n");
}

describe("createNotifier", () => {
  it("passes the arguments to notify-send in order", async () => {
    const log = join(dir, "args.log");
    const bin = await writeScript("notify-send-ok", `printf '%s\\n' "$@" > "${log}"`);
    const notifier: Notifier = createNotifier({ bin });

    const delivered = await notifier.notify(SUCCESS);

    expect(delivered).toBe(true);
    expect(await readLines(log)).toEqual([
      "-a",
      "LAICron",
      "-u",
      "normal",
      "Resumen diario · Correcta",
      "12,3 s · Todo listo",
    ]);
  });

  it("uses the critical urgency and the error text when the run fails", async () => {
    const log = join(dir, "args.log");
    const bin = await writeScript("notify-send-fail", `printf '%s\\n' "$@" > "${log}"`);
    const notifier = createNotifier({ bin });

    const delivered = await notifier.notify({
      jobName: "Limpieza nocturna",
      status: "failed",
      durationMs: 125_000,
      summary: "Salida irrelevante",
      error: "exit code 2: permiso denegado",
    });

    expect(delivered).toBe(true);
    const lines = await readLines(log);
    expect(lines.slice(0, 4)).toEqual(["-a", "LAICron", "-u", "critical"]);
    expect(lines[4]).toBe("Limpieza nocturna · Fallida");
    expect(lines[5]).toBe("2 min 5 s · exit code 2: permiso denegado");
  });

  it("returns false when the binary does not exist", async () => {
    const notifier = createNotifier({ bin: "/nonexistent/notify-send" });

    await expect(notifier.notify(SUCCESS)).resolves.toBe(false);
  });

  it("returns false when notify-send exits with a non-zero code", async () => {
    const bin = await writeScript("notify-send-exit-1", "exit 1");
    const notifier = createNotifier({ bin });

    await expect(notifier.notify(SUCCESS)).resolves.toBe(false);
  });

  it("gives up and returns false when notify-send hangs", { timeout: 15_000 }, async () => {
    const bin = await writeScript("notify-send-hang", "sleep 8");
    const notifier = createNotifier({ bin });

    await expect(notifier.notify(SUCCESS)).resolves.toBe(false);
  });
});
