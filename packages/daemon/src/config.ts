import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Version reported by the daemon and the HTTP API. */
export const VERSION = "0.1.0";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 7317;
const TOKEN_FILE = "token";
const TOKEN_BYTES = 32;

/** Runtime configuration resolved from environment variables. */
export interface Config {
  host: string;
  port: number;
  dbPath: string;
  configDir: string;
  uiRoot: string;
  version: string;
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  return value;
}

function homeDirectory(env: NodeJS.ProcessEnv): string {
  return envValue(env, "HOME") ?? homedir();
}

function dataHome(env: NodeJS.ProcessEnv): string {
  return envValue(env, "XDG_DATA_HOME") ?? join(homeDirectory(env), ".local", "share");
}

function configHome(env: NodeJS.ProcessEnv): string {
  return envValue(env, "XDG_CONFIG_HOME") ?? join(homeDirectory(env), ".config");
}

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    return DEFAULT_PORT;
  }
  return port;
}

function defaultUiRoot(): string {
  // packages/daemon/src/config.ts -> packages/ui/dist
  return fileURLToPath(new URL("../../ui/dist", import.meta.url));
}

/**
 * Resolves the daemon configuration without touching the filesystem, so it can
 * be used from tests and from the boot sequence alike.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    host: envValue(env, "LAICRON_HOST") ?? DEFAULT_HOST,
    port: parsePort(envValue(env, "LAICRON_PORT")),
    dbPath: envValue(env, "LAICRON_DB_PATH") ?? join(dataHome(env), "laicron", "laicron.db"),
    configDir: envValue(env, "LAICRON_CONFIG_DIR") ?? join(configHome(env), "laicron"),
    uiRoot: envValue(env, "LAICRON_UI_ROOT") ?? defaultUiRoot(),
    version: VERSION,
  };
}

function tokenPath(configDir: string): string {
  return join(configDir, TOKEN_FILE);
}

/** Reads the API token, or null when the file does not exist yet. */
export function readToken(configDir: string): string | null {
  try {
    return readFileSync(tokenPath(configDir), "utf8").trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Returns the existing API token or creates a new 32-byte one with 0600
 * permissions. Existing tokens are never rewritten.
 */
export function ensureToken(configDir: string): string {
  const existing = readToken(configDir);
  if (existing !== null) {
    try {
      // Keep the contract even if the file was copied with a wider mode.
      chmodSync(tokenPath(configDir), 0o600);
    } catch {
      // Best effort: the token is still usable when the filesystem refuses chmod.
    }
    return existing;
  }

  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const token = randomBytes(TOKEN_BYTES).toString("hex");

  try {
    writeFileSync(tokenPath(configDir), token, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    // Another process may have created the token between read and write.
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const raced = readToken(configDir);
      if (raced !== null) {
        return raced;
      }
    }
    throw error;
  }

  return token;
}
