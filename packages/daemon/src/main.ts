import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Clock, Engine } from "@laicron/core";
import { createClock, recoverMissedRuns } from "@laicron/core/clock";
import type { RecoveryReport } from "@laicron/core/clock";
import { closeDatabase, createRepositories, openDatabase, type Database } from "@laicron/core/db";
import { createEngine } from "@laicron/core/engine";
import { createRunnerRegistry } from "@laicron/core/runners";
import { getLocale, localeFromEnv, setBaseLocale, t } from "@laicron/core/i18n";
import { createNotifier } from "@laicron/platform-linux";

import { createApiServer, type ApiServer } from "./api/index.js";
import { VERSION, ensureToken, loadConfig, readToken, type Config } from "./config.js";

/** Maximum time to wait for `/api/health` from `open` and `status`. */
const HEALTH_TIMEOUT_MS = 2_000;

/** Resources opened by `start`, tracked so a failure can release them. */
interface DaemonResources {
  clock: Clock | null;
  engine: Engine | null;
  server: ApiServer | null;
  db: Database | null;
}

interface HealthResponse {
  status: "ok";
  version: string | null;
  heartbeatAt: number | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function printHelp(): void {
  console.log(t("cli.help"));
}

function parseHealth(body: unknown): HealthResponse | null {
  if (!isRecord(body) || body["status"] !== "ok") {
    return null;
  }

  const version = typeof body["version"] === "string" ? body["version"] : null;
  const rawHeartbeat = body["heartbeatAt"];
  const heartbeatAt =
    typeof rawHeartbeat === "number" && Number.isFinite(rawHeartbeat) ? rawHeartbeat : null;

  return { status: "ok", version, heartbeatAt };
}

/** Queries the public health endpoint; any network or format problem is `null`. */
async function fetchHealth(config: Config): Promise<HealthResponse | null> {
  try {
    const response = await fetch(`http://${config.host}:${config.port}/api/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return null;
    }
    return parseHealth(await response.json());
  } catch {
    return null;
  }
}

function formatTimestamp(value: number): string {
  return new Intl.DateTimeFormat(getLocale() === "es" ? "es-ES" : "en-US", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

/** Prints one line when the previous daemon left work to recover. */
function printRecoveryReport(report: RecoveryReport): void {
  const total = report.interrupted + report.executed + report.skipped;
  if (total === 0 && report.jobs.length === 0) {
    return;
  }

  const parts = [t("cli.recoveryInterrupted", { count: report.interrupted })];
  if (report.jobs.length > 0) {
    const jobs =
      report.jobs.length === 1
        ? t("cli.jobsOne")
        : t("cli.jobsMany", { count: report.jobs.length });
    parts.push(
      t("cli.recoveryExecuted", { count: report.executed }),
      t("cli.recoverySkipped", { count: report.skipped, jobs }),
    );
  }

  console.log(t("cli.recoveryLine", { details: parts.join(", ") }));
}

/**
 * Releases everything the daemon opened, in reverse order of acquisition.
 * Every step is attempted even if a previous one fails.
 */
async function shutdown(resources: DaemonResources): Promise<void> {
  const { clock, engine, server, db } = resources;

  if (clock !== null) {
    try {
      await clock.stop();
    } catch (error) {
      console.error(t("cli.clockStopError", { detail: errorMessage(error) }));
    }
  }

  if (engine !== null) {
    try {
      await engine.cancelAll();
    } catch (error) {
      console.error(t("cli.cancelError", { detail: errorMessage(error) }));
    }
  }

  if (server !== null) {
    try {
      await server.stop();
    } catch (error) {
      console.error(t("cli.serverStopError", { detail: errorMessage(error) }));
    }
  }

  if (db !== null) {
    try {
      closeDatabase(db);
    } catch (error) {
      console.error(t("cli.dbCloseError", { detail: errorMessage(error) }));
    }
  }
}

/** Resolves with the exit code once SIGTERM or SIGINT asks the daemon to stop. */
function waitForShutdown(resources: DaemonResources): Promise<number> {
  return new Promise<number>((resolve) => {
    let stopping = false;
    let settled = false;

    const finish = (code: number): void => {
      if (settled) {
        return;
      }
      settled = true;
      process.off("SIGTERM", onSignal);
      process.off("SIGINT", onSignal);
      resolve(code);
    };

    const onSignal = (): void => {
      // A second signal while shutting down must not run the cleanup twice.
      if (stopping) {
        return;
      }
      stopping = true;

      void shutdown(resources).then(() => {
        finish(0);
      });
    };

    process.on("SIGTERM", onSignal);
    process.on("SIGINT", onSignal);
  });
}

async function startDaemon(): Promise<number> {
  const resources: DaemonResources = { clock: null, engine: null, server: null, db: null };

  try {
    const config = loadConfig();
    const token = ensureToken(config.configDir);

    const db = openDatabase(config.dbPath);
    resources.db = db;

    const { jobs, runs, messages, meta } = createRepositories(db);
    const runners = createRunnerRegistry();
    const notifier = createNotifier();
    const engine = createEngine({ jobs, runs, messages, runners, notifier });
    resources.engine = engine;

    const recovery = await recoverMissedRuns({ engine, jobs, runs, meta });
    printRecoveryReport(recovery);

    const clock = createClock({ engine, jobs, runs, meta });
    resources.clock = clock;
    await clock.start();

    const server = createApiServer({
      engine,
      jobs,
      runs,
      messages,
      meta,
      token,
      uiRoot: config.uiRoot,
      version: VERSION,
    });
    resources.server = server;

    const port = await server.start(config.port, config.host);
    console.log(t("cli.listening", { url: `http://${config.host}:${port}` }));

    return await waitForShutdown(resources);
  } catch (error) {
    console.error(t("cli.startFailed", { detail: errorMessage(error) }));
    await shutdown(resources);
    return 1;
  }
}

async function openWindow(): Promise<number> {
  const config = loadConfig();
  ensureToken(config.configDir);
  const token = readToken(config.configDir);

  if (token === null) {
    console.error(t("cli.tokenUnreadable"));
    return 1;
  }

  if ((await fetchHealth(config)) === null) {
    console.error(t("cli.daemonInactive"));
    return 1;
  }

  const windowScript = fileURLToPath(
    new URL("../../platform/linux/src/window.py", import.meta.url),
  );

  if (!existsSync(windowScript)) {
    console.error(t("cli.windowLauncherMissing", { path: windowScript }));
    return 1;
  }

  const url = `http://${config.host}:${config.port}/#token=${token}`;
  const child = spawn("python3", [windowScript, url], {
    detached: true,
    stdio: "ignore",
  });

  try {
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => {
        resolve();
      });
      child.once("error", reject);
    });
  } catch (error) {
    console.error(t("cli.windowFailed", { detail: errorMessage(error) }));
    return 1;
  }

  child.unref();
  return 0;
}

async function printStatus(): Promise<number> {
  const config = loadConfig();
  const health = await fetchHealth(config);

  if (health === null) {
    console.log(t("cli.inactive"));
    return 1;
  }

  const version = health.version ?? config.version;
  const heartbeat =
    health.heartbeatAt === null ? t("cli.noHeartbeat") : formatTimestamp(health.heartbeatAt);

  console.log(t("cli.active", { version }));
  console.log(t("cli.lastHeartbeat", { value: heartbeat }));
  return 0;
}

function printTokenPath(): number {
  const config = loadConfig();
  console.log(join(config.configDir, "token"));
  return 0;
}

/**
 * CLI entry point. Returns the process exit code and never terminates the
 * process itself, so the binary can decide when to exit.
 */
export async function main(argv: string[]): Promise<number> {
  setBaseLocale(localeFromEnv());
  const command = argv[0] ?? "start";

  try {
    switch (command) {
      case "start":
        return await startDaemon();
      case "open":
        return await openWindow();
      case "status":
        return await printStatus();
      case "token":
        return printTokenPath();
      case "help":
      case "--help":
      case "-h":
        printHelp();
        return 0;
      case "--version":
      case "-v":
        console.log(VERSION);
        return 0;
      default:
        console.error(t("cli.unknownCommand", { command }));
        printHelp();
        return 1;
    }
  } catch (error) {
    console.error(t("cli.error", { detail: errorMessage(error) }));
    return 1;
  }
}

// Executing this file directly (for example from the systemd unit) behaves
// like the CLI, while importing it from the binary or a test has no side
// effects: the guard only matches when this module is the process entry point.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
