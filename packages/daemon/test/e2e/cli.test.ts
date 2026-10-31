import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDirectory, "../../../..");
const mainPath = join(repoRoot, "packages", "daemon", "dist", "main.js");

const HEALTH_TIMEOUT_MS = 10_000;
const RUN_TIMEOUT_MS = 15_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

const TERMINAL_STATUSES = new Set(["success", "failed", "timeout", "interrupted", "skipped"]);

interface ExitResult {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface DaemonHandle {
  child: ChildProcess;
  stdout: () => string;
  stderr: () => string;
  exit: Promise<ExitResult>;
}

interface JobResponse {
  job: { id: string };
}

interface RunRecord {
  id: string;
  trigger: string;
  status: string;
  output: string | null;
}

interface RunsResponse {
  runs: RunRecord[];
}

interface MessagesResponse {
  messages: Array<{ role: string; content: string; runId: string }>;
}

let directory: string | null = null;
let configDir = "";
let uiRoot = "";
let port = 0;
let token = "";
let env: NodeJS.ProcessEnv = {};
let daemon: DaemonHandle | null = null;

/** Compiles one workspace package and surfaces its output when it fails. */
function buildPackage(filter: string): void {
  try {
    execFileSync("pnpm", ["--filter", filter, "build"], {
      cwd: repoRoot,
      stdio: "pipe",
      encoding: "utf8",
    });
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    throw new Error(
      `Falló la compilación de ${filter}.\n${failure.stdout ?? ""}\n${failure.stderr ?? ""}`,
    );
  }
}

/** Reserves an ephemeral TCP port and releases it before returning. */
function getFreePort(): Promise<number> {
  return new Promise<number>((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        rejectPort(new Error("No se pudo reservar un puerto libre."));
        return;
      }

      const freePort = address.port;
      server.close((error) => {
        if (error) {
          rejectPort(error);
        } else {
          resolvePort(freePort);
        }
      });
    });
  });
}

function startDaemon(): DaemonHandle {
  const child = spawn(process.execPath, [mainPath, "start"], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const exit = new Promise<ExitResult>((resolveExit, rejectExit) => {
    child.once("exit", (code, signal) => {
      resolveExit({ code, signal });
    });
    child.once("error", rejectExit);
  });

  return {
    child,
    stdout: () => stdout,
    stderr: () => stderr,
    exit,
  };
}

function runningDaemon(): DaemonHandle {
  if (daemon === null) {
    throw new Error("El daemon de prueba no está en marcha.");
  }
  return daemon;
}

async function waitForHealth(handle: DaemonHandle, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (handle.child.exitCode !== null || handle.child.signalCode !== null) {
      throw new Error(
        `El daemon terminó antes de estar listo.\nstdout:\n${handle.stdout()}\nstderr:\n${handle.stderr()}`,
      );
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // The socket is not listening yet; keep polling.
    }

    await delay(200);
  }

  throw new Error(
    `El daemon no respondió en ${timeoutMs} ms.\nstdout:\n${handle.stdout()}\nstderr:\n${handle.stderr()}`,
  );
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers });
}

/** Waits for the manual run of a job to reach a terminal status. */
async function waitForFinishedRun(jobId: string, timeoutMs: number): Promise<RunRecord> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await api(`/api/jobs/${jobId}/runs`);
    if (!response.ok) {
      throw new Error(`GET /api/jobs/${jobId}/runs devolvió ${response.status}.`);
    }

    const body = (await response.json()) as RunsResponse;
    const run = body.runs.find((candidate) => candidate.trigger === "manual") ?? body.runs[0];
    if (run !== undefined && TERMINAL_STATUSES.has(run.status)) {
      return run;
    }

    await delay(150);
  }

  throw new Error(`El run no terminó en ${timeoutMs} ms.`);
}

/** Sends a signal and waits for the exit, killing the process on timeout. */
async function terminate(
  handle: DaemonHandle,
  signal: NodeJS.Signals,
  timeoutMs: number,
): Promise<ExitResult> {
  if (handle.child.exitCode !== null || handle.child.signalCode !== null) {
    return handle.exit;
  }

  handle.child.kill(signal);

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      handle.child.kill("SIGKILL");
      reject(new Error(`El daemon no terminó en ${timeoutMs} ms.`));
    }, timeoutMs);
    timer.unref();
  });

  try {
    return await Promise.race([handle.exit, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

beforeAll(async () => {
  buildPackage("@laicron/core");
  buildPackage("@laicron/daemon");

  directory = mkdtempSync(join(tmpdir(), "laicron-e2e-"));
  configDir = join(directory, "config");
  uiRoot = join(directory, "ui");
  mkdirSync(configDir, { recursive: true });
  mkdirSync(uiRoot, { recursive: true });
  writeFileSync(
    join(uiRoot, "index.html"),
    "<!doctype html><html><body><h1>LAICron E2E</h1></body></html>",
  );

  port = await getFreePort();
  env = {
    ...process.env,
    HOME: directory,
    LAICRON_HOST: "127.0.0.1",
    LAICRON_PORT: String(port),
    LAICRON_DB_PATH: join(directory, "laicron.db"),
    LAICRON_CONFIG_DIR: configDir,
    LAICRON_UI_ROOT: uiRoot,
  };

  daemon = startDaemon();
  try {
    await waitForHealth(daemon, HEALTH_TIMEOUT_MS);
    token = readFileSync(join(configDir, "token"), "utf8").trim();
  } catch (error) {
    // Do not leave the daemon running when the setup fails before the tests.
    daemon.child.kill("SIGKILL");
    throw error;
  }
}, 90_000);

afterAll(async () => {
  if (daemon !== null) {
    if (daemon.child.exitCode === null && daemon.child.signalCode === null) {
      daemon.child.kill("SIGKILL");
    }
    await daemon.exit.catch(() => undefined);
  }

  if (directory !== null) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("laicron CLI end-to-end", () => {
  it("ejecuta un cron shell y se detiene ordenadamente con SIGTERM", async () => {
    const tokenHasExpectedShape = /^[0-9a-f]{64}$/.test(token);
    expect(tokenHasExpectedShape).toBe(true);

    const scheduleExpr = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const createResponse = await api("/api/jobs", {
      method: "POST",
      body: JSON.stringify({
        name: "E2E shell",
        runner: "shell",
        command: "echo hola-e2e",
        scheduleKind: "once",
        scheduleExpr,
        notify: false,
      }),
    });
    expect(createResponse.status).toBe(201);

    const created = (await createResponse.json()) as JobResponse;
    expect(created.job.id).toBeTruthy();

    const runResponse = await api(`/api/jobs/${created.job.id}/run`, { method: "POST" });
    expect(runResponse.status).toBe(202);

    const run = await waitForFinishedRun(created.job.id, RUN_TIMEOUT_MS);
    expect(run.status).toBe("success");
    expect(run.trigger).toBe("manual");
    expect(run.output).toContain("hola-e2e");

    const messagesResponse = await api(`/api/jobs/${created.job.id}/messages`);
    expect(messagesResponse.status).toBe(200);
    const messages = (await messagesResponse.json()) as MessagesResponse;
    expect(
      messages.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.runId === run.id &&
          message.content.includes("hola-e2e"),
      ),
    ).toBe(true);

    expect(runningDaemon().stdout()).toContain(`LAICron escuchando en http://127.0.0.1:${port}`);

    const startedAt = Date.now();
    const exit = await terminate(runningDaemon(), "SIGTERM", SHUTDOWN_TIMEOUT_MS);
    const elapsed = Date.now() - startedAt;

    expect(exit.code).toBe(0);
    expect(elapsed).toBeLessThan(SHUTDOWN_TIMEOUT_MS);
  }, 30_000);

  it("status devuelve 1 e imprime inactivo cuando el daemon está parado", async () => {
    const stoppedPort = await getFreePort();
    const result = spawnSync(process.execPath, [mainPath, "status"], {
      cwd: repoRoot,
      env: { ...env, LAICRON_PORT: String(stoppedPort) },
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("inactivo");
  }, 20_000);

  it("token imprime la ruta del fichero y nunca su contenido", () => {
    const result = spawnSync(process.execPath, [mainPath, "token"], {
      cwd: repoRoot,
      env,
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(result.status).toBe(0);

    // Assert through booleans so a failure never prints the token itself.
    const printsPath = result.stdout.trim() === join(configDir, "token");
    const leaksToken = result.stdout.includes(token);
    expect(printsPath).toBe(true);
    expect(leaksToken).toBe(false);
  }, 20_000);
});
