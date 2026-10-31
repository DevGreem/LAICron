import { lstat, mkdir, mkdtemp, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSystemdInstaller,
  renderDesktop,
  renderUnit,
  type ExecFn,
  type ExecResult,
} from "../src/service-installer.js";

const UNIT_TEMPLATE = new URL("../units/laicron.service", import.meta.url);
const DESKTOP_TEMPLATE = new URL("../laicron.desktop", import.meta.url);

const REPO_ROOT = "/opt/laicron";
const NODE_BIN = "/usr/bin/node";

let home: string;

function pathEnvFor(homeDir: string): string {
  return `${join(homeDir, ".local", "bin")}:/usr/local/bin:/usr/bin:/bin`;
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "laicron-installer-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

interface Call {
  cmd: string;
  args: string[];
}

function createFakeExec(result: ExecResult = { code: 0, stdout: "", stderr: "" }): {
  calls: Call[];
  exec: ExecFn;
} {
  const calls: Call[] = [];
  const exec: ExecFn = async (cmd, args) => {
    calls.push({ cmd, args });
    return { ...result };
  };

  return { calls, exec };
}

function paths() {
  return {
    env: join(home, ".config", "laicron", "env"),
    unit: join(home, ".config", "systemd", "user", "laicron.service"),
    desktop: join(home, ".local", "share", "applications", "laicron.desktop"),
    data: join(home, ".local", "share", "laicron"),
    binLink: join(home, ".local", "bin", "laicron"),
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    // lstat() also detects dangling symlinks, unlike access().
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function modeOf(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777;
}

describe("renderUnit", () => {
  it("substitutes every placeholder", async () => {
    const template = await readFile(UNIT_TEMPLATE, "utf8");

    const rendered = renderUnit(template, { repoRoot: REPO_ROOT, nodeBin: NODE_BIN });

    expect(rendered).toContain(`ExecStart=${NODE_BIN} ${REPO_ROOT}/packages/daemon/dist/main.js`);
    expect(rendered).toContain(`WorkingDirectory=${REPO_ROOT}`);
    expect(rendered).not.toMatch(/@[A-Z0-9_]+@/u);
  });

  it("rejects a template with an unknown placeholder", () => {
    expect(() =>
      renderUnit("ExecStart=@NODE_BIN@ @MISSING@", { repoRoot: REPO_ROOT, nodeBin: NODE_BIN }),
    ).toThrow(/@MISSING@/u);
  });
});

describe("renderDesktop", () => {
  it("substitutes every placeholder", async () => {
    const template = await readFile(DESKTOP_TEMPLATE, "utf8");

    const rendered = renderDesktop(template, { repoRoot: REPO_ROOT });

    expect(rendered).toContain(`Exec=${REPO_ROOT}/packages/daemon/bin/laicron.js open`);
    expect(rendered).not.toMatch(/@[A-Z0-9_]+@/u);
  });
});

describe("systemd installer", () => {
  it("writes the env, unit and desktop files and enables the service", async () => {
    const { calls, exec } = createFakeExec();

    await createSystemdInstaller().install({
      repoRoot: REPO_ROOT,
      nodeBin: NODE_BIN,
      pathEnv: pathEnvFor(home),
      homeDir: home,
      exec,
    });

    const target = paths();
    const unitTemplate = await readFile(UNIT_TEMPLATE, "utf8");
    const desktopTemplate = await readFile(DESKTOP_TEMPLATE, "utf8");

    expect(await readFile(target.env, "utf8")).toBe(`PATH=${pathEnvFor(home)}\n`);
    expect(await readFile(target.unit, "utf8")).toBe(
      renderUnit(unitTemplate, { repoRoot: REPO_ROOT, nodeBin: NODE_BIN }),
    );
    expect(await readFile(target.desktop, "utf8")).toBe(
      renderDesktop(desktopTemplate, { repoRoot: REPO_ROOT }),
    );

    expect(await modeOf(target.env)).toBe(0o600);
    expect(await modeOf(target.unit)).toBe(0o644);
    expect(await modeOf(target.desktop)).toBe(0o644);

    expect(await readlink(target.binLink)).toBe(
      join(REPO_ROOT, "packages", "daemon", "bin", "laicron.js"),
    );

    expect(calls).toEqual([
      { cmd: "systemctl", args: ["--user", "daemon-reload"] },
      { cmd: "systemctl", args: ["--user", "enable", "--now", "laicron"] },
      { cmd: "loginctl", args: ["enable-linger", userInfo().username] },
    ]);
  });

  it("creates the launcher symlink in ~/.local/bin", async () => {
    await createSystemdInstaller().install({
      repoRoot: REPO_ROOT,
      nodeBin: NODE_BIN,
      pathEnv: pathEnvFor(home),
      homeDir: home,
      exec: createFakeExec().exec,
    });

    expect(await readlink(paths().binLink)).toBe(
      join(REPO_ROOT, "packages", "daemon", "bin", "laicron.js"),
    );
  });

  it("enables linger for the current user", async () => {
    const { calls, exec } = createFakeExec();

    await createSystemdInstaller().install({
      repoRoot: REPO_ROOT,
      nodeBin: NODE_BIN,
      pathEnv: pathEnvFor(home),
      homeDir: home,
      exec,
    });

    expect(calls).toContainEqual({
      cmd: "loginctl",
      args: ["enable-linger", userInfo().username],
    });
  });

  it("does not fail when loginctl fails", async () => {
    const calls: Call[] = [];
    const exec: ExecFn = async (cmd, args) => {
      calls.push({ cmd, args });
      return cmd === "loginctl"
        ? { code: 1, stdout: "", stderr: "Interactive authentication required" }
        : { code: 0, stdout: "", stderr: "" };
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(
      createSystemdInstaller().install({
        repoRoot: REPO_ROOT,
        nodeBin: NODE_BIN,
        pathEnv: pathEnvFor(home),
        homeDir: home,
        exec,
      }),
    ).resolves.toBeUndefined();

    const messages = log.mock.calls.map((call) => call[0]);
    log.mockRestore();

    expect(messages).toContainEqual(expect.stringContaining("loginctl enable-linger"));
  });

  it("warns when ~/.local/bin is not in PATH", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await createSystemdInstaller().install({
      repoRoot: REPO_ROOT,
      nodeBin: NODE_BIN,
      pathEnv: "/usr/bin:/bin",
      homeDir: home,
      exec: createFakeExec().exec,
    });

    const messages = log.mock.calls.map((call) => call[0]);
    log.mockRestore();

    expect(messages).toContainEqual(expect.stringContaining(join(home, ".local", "bin")));
  });

  it("is idempotent when installed twice", async () => {
    const { calls, exec } = createFakeExec();
    const installer = createSystemdInstaller();
    const options = {
      repoRoot: REPO_ROOT,
      nodeBin: NODE_BIN,
      pathEnv: pathEnvFor(home),
      homeDir: home,
      exec,
    };

    await installer.install(options);
    const firstUnit = await readFile(paths().unit, "utf8");
    const firstDesktop = await readFile(paths().desktop, "utf8");

    await expect(installer.install(options)).resolves.toBeUndefined();

    expect(await readFile(paths().unit, "utf8")).toBe(firstUnit);
    expect(await readFile(paths().desktop, "utf8")).toBe(firstDesktop);
    expect(await readlink(paths().binLink)).toBe(
      join(REPO_ROOT, "packages", "daemon", "bin", "laicron.js"),
    );
    expect(calls).toHaveLength(6);
  });

  it("throws with the stderr when systemctl fails", async () => {
    const { exec } = createFakeExec({
      code: 1,
      stdout: "",
      stderr: "Failed to connect to bus",
    });

    await expect(
      createSystemdInstaller().install({
        repoRoot: REPO_ROOT,
        nodeBin: NODE_BIN,
        pathEnv: pathEnvFor(home),
        homeDir: home,
        exec,
      }),
    ).rejects.toThrow(/Failed to connect to bus/u);
  });

  it("keeps the data directory when uninstalling without purge", async () => {
    const installer = createSystemdInstaller();
    await installer.install({
      repoRoot: REPO_ROOT,
      nodeBin: NODE_BIN,
      pathEnv: pathEnvFor(home),
      homeDir: home,
      exec: createFakeExec().exec,
    });

    const target = paths();
    await mkdir(target.data, { recursive: true });
    await writeFile(join(target.data, "laicron.db"), "db", "utf8");
    expect(await exists(target.binLink)).toBe(true);

    const { calls, exec } = createFakeExec();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await installer.uninstall({ homeDir: home, exec });
    const messages = log.mock.calls.map((call) => call[0]);
    log.mockRestore();

    expect(await exists(target.unit)).toBe(false);
    expect(await exists(target.desktop)).toBe(false);
    expect(await exists(target.binLink)).toBe(false);
    expect(await readFile(join(target.data, "laicron.db"), "utf8")).toBe("db");
    expect(messages).toContainEqual(expect.stringContaining(target.data));
    expect(calls).toEqual([
      { cmd: "systemctl", args: ["--user", "disable", "--now", "laicron"] },
      { cmd: "systemctl", args: ["--user", "daemon-reload"] },
    ]);
  });

  it("removes the data directory when uninstalling with purge", async () => {
    const installer = createSystemdInstaller();
    await installer.install({
      repoRoot: REPO_ROOT,
      nodeBin: NODE_BIN,
      pathEnv: pathEnvFor(home),
      homeDir: home,
      exec: createFakeExec().exec,
    });

    const target = paths();
    await mkdir(target.data, { recursive: true });
    await writeFile(join(target.data, "laicron.db"), "db", "utf8");

    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await installer.uninstall({ homeDir: home, purgeData: true, exec: createFakeExec().exec });
    log.mockRestore();

    expect(await exists(target.unit)).toBe(false);
    expect(await exists(target.desktop)).toBe(false);
    expect(await exists(target.binLink)).toBe(false);
    expect(await exists(target.data)).toBe(false);
  });

  it("reports installed and active from the unit file and is-active", async () => {
    const installer = createSystemdInstaller();
    const target = paths();
    await mkdir(join(home, ".config", "systemd", "user"), { recursive: true });
    await writeFile(target.unit, "", "utf8");

    const active = createFakeExec({ code: 0, stdout: "active\n", stderr: "" });
    await expect(installer.status({ homeDir: home, exec: active.exec })).resolves.toEqual({
      installed: true,
      active: true,
    });
    expect(active.calls).toEqual([{ cmd: "systemctl", args: ["--user", "is-active", "laicron"] }]);

    const inactive = createFakeExec({ code: 3, stdout: "inactive\n", stderr: "" });
    await expect(installer.status({ homeDir: home, exec: inactive.exec })).resolves.toEqual({
      installed: true,
      active: false,
    });

    await rm(target.unit, { force: true });
    const missing = createFakeExec({ code: 3, stdout: "inactive\n", stderr: "" });
    await expect(installer.status({ homeDir: home, exec: missing.exec })).resolves.toEqual({
      installed: false,
      active: false,
    });
  });
});
