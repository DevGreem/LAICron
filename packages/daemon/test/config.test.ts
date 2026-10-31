import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { VERSION, ensureToken, loadConfig, readToken } from "../src/config.js";

const directories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "laicron-config-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("loadConfig", () => {
  it("uses XDG defaults when no override is present", () => {
    const config = loadConfig({ HOME: "/home/tester" });

    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(7317);
    expect(config.dbPath).toBe("/home/tester/.local/share/laicron/laicron.db");
    expect(config.configDir).toBe("/home/tester/.config/laicron");
    expect(config.version).toBe(VERSION);
    expect(config.uiRoot.endsWith(join("packages", "ui", "dist"))).toBe(true);
  });

  it("honours XDG and LAICRON environment variables", () => {
    const config = loadConfig({
      HOME: "/home/tester",
      XDG_DATA_HOME: "/data",
      XDG_CONFIG_HOME: "/config",
      LAICRON_HOST: "0.0.0.0",
      LAICRON_PORT: "9001",
      LAICRON_DB_PATH: "/custom/laicron.db",
      LAICRON_CONFIG_DIR: "/custom/config",
      LAICRON_UI_ROOT: "/custom/ui",
    });

    expect(config).toEqual({
      host: "0.0.0.0",
      port: 9001,
      dbPath: "/custom/laicron.db",
      configDir: "/custom/config",
      uiRoot: "/custom/ui",
      version: VERSION,
    });
  });

  it("falls back to the default port when the value is not a valid port", () => {
    expect(loadConfig({ HOME: "/home/tester", LAICRON_PORT: "nope" }).port).toBe(7317);
    expect(loadConfig({ HOME: "/home/tester", LAICRON_PORT: "70000" }).port).toBe(7317);
    expect(loadConfig({ HOME: "/home/tester", LAICRON_PORT: "-1" }).port).toBe(7317);
  });

  it("does not create directories or files", () => {
    const root = temporaryDirectory();
    const configDir = join(root, "config");
    const dbPath = join(root, "data", "laicron.db");

    loadConfig({ HOME: root, LAICRON_CONFIG_DIR: configDir, LAICRON_DB_PATH: dbPath });

    expect(existsSync(configDir)).toBe(false);
    expect(existsSync(dbPath)).toBe(false);
  });
});

describe("token handling", () => {
  it("returns null from readToken when the file does not exist", () => {
    expect(readToken(join(temporaryDirectory(), "missing"))).toBeNull();
  });

  it("creates a 64-character hex token with 0600 permissions", () => {
    const configDir = join(temporaryDirectory(), "nested", "config");

    const token = ensureToken(configDir);

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(join(configDir, "token"), "utf8")).toBe(token);
    expect(statSync(join(configDir, "token")).mode & 0o777).toBe(0o600);
    expect(readToken(configDir)).toBe(token);
  });

  it("is idempotent and returns the existing token without rewriting it", () => {
    const configDir = temporaryDirectory();

    const first = ensureToken(configDir);
    const tokenFile = join(configDir, "token");
    const inodeBefore = statSync(tokenFile).ino;

    const second = ensureToken(configDir);

    expect(second).toBe(first);
    expect(readToken(configDir)).toBe(first);
    expect(statSync(tokenFile).ino).toBe(inodeBefore);
  });
});
