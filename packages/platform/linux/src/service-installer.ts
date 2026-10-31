import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { access, chmod, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Result of running an external command. */
export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a command and resolves with its exit code and output. */
export type ExecFn = (cmd: string, args: string[]) => Promise<ExecResult>;

export interface InstallOptions {
  repoRoot: string;
  nodeBin: string;
  pathEnv: string;
  homeDir?: string;
  exec?: ExecFn;
}

export interface ServiceInstaller {
  install(opts: InstallOptions): Promise<void>;
  uninstall(opts: { homeDir?: string; purgeData?: boolean; exec?: ExecFn }): Promise<void>;
  status(opts?: {
    homeDir?: string;
    exec?: ExecFn;
  }): Promise<{ installed: boolean; active: boolean }>;
}

const SERVICE_NAME = "laicron";
const UNIT_FILE = `${SERVICE_NAME}.service`;
const DESKTOP_FILE = "laicron.desktop";

/**
 * Default {@link ExecFn}: wraps `execFile` in a promise and resolves for
 * non-zero exit codes instead of rejecting, so callers can inspect stderr.
 */
const defaultExec: ExecFn = (cmd, args) =>
  new Promise<ExecResult>((resolvePromise) => {
    execFile(cmd, args, { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error === null) {
        resolvePromise({ code: 0, stdout, stderr });
        return;
      }

      // A string code means the process could not be spawned (for example,
      // ENOENT when systemctl is not installed).
      const code = typeof error.code === "number" ? error.code : 127;
      resolvePromise({
        code,
        stdout: stdout ?? "",
        stderr: stderr !== undefined && stderr !== "" ? stderr : error.message,
      });
    });
  });

interface InstallerPaths {
  envFile: string;
  unitFile: string;
  desktopFile: string;
  dataDir: string;
  binDir: string;
  binLink: string;
}

function pathsFor(home: string): InstallerPaths {
  const configDir = join(home, ".config", "laicron");
  const systemdDir = join(home, ".config", "systemd", "user");
  const applicationsDir = join(home, ".local", "share", "applications");
  const binDir = join(home, ".local", "bin");

  return {
    envFile: join(configDir, "env"),
    unitFile: join(systemdDir, UNIT_FILE),
    desktopFile: join(applicationsDir, DESKTOP_FILE),
    dataDir: join(home, ".local", "share", "laicron"),
    binDir,
    binLink: join(binDir, "laicron"),
  };
}

function unitTemplateUrl(): URL {
  // Works both from src/ (tests) and from dist/ (installed CLI).
  return new URL("../units/laicron.service", import.meta.url);
}

function desktopTemplateUrl(): URL {
  return new URL("../laicron.desktop", import.meta.url);
}

/**
 * Replaces every `@NAME@` placeholder in a template.
 *
 * Throws when the template still contains a placeholder without a value, so a
 * broken unit is never written to disk.
 */
function substitute(template: string, values: Readonly<Record<string, string>>): string {
  const rendered = template.replace(/@([A-Z0-9_]+)@/gu, (placeholder, name: string) => {
    const value = values[name];
    return value === undefined ? placeholder : value;
  });

  const unresolved = /@[A-Z0-9_]+@/u.exec(rendered);
  if (unresolved !== null) {
    throw new Error(`La plantilla contiene una variable sin resolver: ${unresolved[0]}`);
  }

  return rendered;
}

export function renderUnit(template: string, vars: { repoRoot: string; nodeBin: string }): string {
  return substitute(template, {
    REPO_ROOT: vars.repoRoot,
    NODE_BIN: vars.nodeBin,
  });
}

export function renderDesktop(template: string, vars: { repoRoot: string }): string {
  return substitute(template, { REPO_ROOT: vars.repoRoot });
}

async function writeFileWithMode(path: string, content: string, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  // writeFile only applies the mode on creation, and umask may mask it.
  await chmod(path, mode);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function runSystemctl(exec: ExecFn, args: string[]): Promise<void> {
  const result = await exec("systemctl", args);
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `código ${result.code}`;
    throw new Error(`El comando "systemctl ${args.join(" ")}" falló: ${detail}`);
  }
}

/** Creates (or replaces) the `~/.local/bin/laicron` launcher symlink. */
async function replaceSymlink(linkPath: string, target: string): Promise<void> {
  await mkdir(dirname(linkPath), { recursive: true });
  await rm(linkPath, { force: true });
  await symlink(target, linkPath);
}

/** True when `directory` appears in a PATH-like value. */
function isDirectoryOnPath(pathEnv: string, directory: string): boolean {
  const wanted = resolve(directory);
  return pathEnv
    .split(delimiter)
    .filter((entry) => entry.length > 0)
    .some((entry) => resolve(entry) === wanted);
}

/**
 * Asks systemd to keep the user manager alive after the session closes.
 *
 * This is best effort: distributions may not allow it without extra
 * privileges, and the installed service still works while the user is logged
 * in.
 */
async function enableLinger(exec: ExecFn): Promise<void> {
  let username: string;
  try {
    username = userInfo().username;
  } catch {
    console.log("Aviso: no se pudo determinar el usuario para loginctl enable-linger.");
    return;
  }

  let result: ExecResult;
  try {
    result = await exec("loginctl", ["enable-linger", username]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.log(
      `Aviso: no se pudo habilitar la persistencia de sesión con "loginctl enable-linger ${username}": ${detail}`,
    );
    return;
  }

  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `código ${result.code}`;
    console.log(
      `Aviso: no se pudo habilitar la persistencia de sesión con "loginctl enable-linger ${username}": ${detail}`,
    );
  }
}

/**
 * Creates the systemd `--user` installer.
 *
 * Templates are read from the package directory on every call, so edits to the
 * unit or desktop file take effect without rebuilding the module.
 */
export function createSystemdInstaller(): ServiceInstaller {
  return {
    async install(opts: InstallOptions): Promise<void> {
      const exec = opts.exec ?? defaultExec;
      const home = opts.homeDir ?? homedir();
      const paths = pathsFor(home);

      const [unitTemplate, desktopTemplate] = await Promise.all([
        readFile(unitTemplateUrl(), "utf8"),
        readFile(desktopTemplateUrl(), "utf8"),
      ]);

      const unit = renderUnit(unitTemplate, {
        repoRoot: opts.repoRoot,
        nodeBin: opts.nodeBin,
      });
      const desktop = renderDesktop(desktopTemplate, { repoRoot: opts.repoRoot });

      await writeFileWithMode(paths.envFile, `PATH=${opts.pathEnv}\n`, 0o600);
      await writeFileWithMode(paths.unitFile, unit, 0o644);
      await writeFileWithMode(paths.desktopFile, desktop, 0o644);

      await runSystemctl(exec, ["--user", "daemon-reload"]);
      await runSystemctl(exec, ["--user", "enable", "--now", SERVICE_NAME]);

      const binTarget = join(opts.repoRoot, "packages", "daemon", "bin", "laicron.js");
      await replaceSymlink(paths.binLink, binTarget);

      if (!isDirectoryOnPath(opts.pathEnv, paths.binDir)) {
        console.log(
          `Aviso: ${paths.binDir} no está en el PATH. Añádelo para ejecutar "laicron" desde cualquier sitio.`,
        );
      }

      await enableLinger(exec);
    },

    async uninstall(opts: { homeDir?: string; purgeData?: boolean; exec?: ExecFn }): Promise<void> {
      const exec = opts.exec ?? defaultExec;
      const home = opts.homeDir ?? homedir();
      const paths = pathsFor(home);

      // Best effort: the unit may already be stopped or never loaded. Removing
      // the files below still leaves the system clean.
      await exec("systemctl", ["--user", "disable", "--now", SERVICE_NAME]);

      await rm(paths.unitFile, { force: true });
      await rm(paths.desktopFile, { force: true });
      await rm(paths.binLink, { force: true });

      await exec("systemctl", ["--user", "daemon-reload"]);

      if (opts.purgeData === true) {
        await rm(paths.dataDir, { recursive: true, force: true });
        console.log("Se han borrado la base de datos y el historial de LAICron.");
      } else {
        console.log(`Los datos de LAICron se conservan en ${paths.dataDir}`);
      }
    },

    async status(opts: { homeDir?: string; exec?: ExecFn } = {}): Promise<{
      installed: boolean;
      active: boolean;
    }> {
      const exec = opts.exec ?? defaultExec;
      const home = opts.homeDir ?? homedir();
      const paths = pathsFor(home);

      const installed = await fileExists(paths.unitFile);
      const result = await exec("systemctl", ["--user", "is-active", SERVICE_NAME]);

      return { installed, active: result.code === 0 };
    },
  };
}

/** True when this module is the entry point, not an import from another one. */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }

  const modulePath = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(modulePath);
  } catch {
    return resolve(entry) === modulePath;
  }
}

/** Resolves the values the CLI passes to the installer. */
function cliContext(): { repoRoot: string; nodeBin: string; pathEnv: string } {
  return {
    // dist/service-installer.js -> repository root.
    repoRoot: resolve(fileURLToPath(new URL("../../../..", import.meta.url))),
    nodeBin: process.execPath,
    pathEnv: process.env.PATH ?? "",
  };
}

async function runCli(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  const installer = createSystemdInstaller();

  if (command === "install") {
    const context = cliContext();
    console.log(`Instalando LAICron desde ${context.repoRoot}...`);
    await installer.install(context);
    console.log("Servicio laicron.service instalado y activo.");
    return 0;
  }

  if (command === "uninstall") {
    await installer.uninstall({ purgeData: args.includes("--purge-data") });
    console.log("Servicio laicron.service desinstalado.");
    return 0;
  }

  if (command === "status") {
    const result = await installer.status();
    console.log(`Instalado: ${result.installed ? "sí" : "no"}`);
    console.log(`Activo: ${result.active ? "sí" : "no"}`);
    return 0;
  }

  console.error("Uso: service-installer.js <install|uninstall [--purge-data]|status>");
  return 1;
}

if (isMainModule()) {
  runCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exitCode = 1;
    },
  );
}
