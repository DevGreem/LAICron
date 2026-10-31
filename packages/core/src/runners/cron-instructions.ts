import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Fixed instruction injected into every cron run. It is owned by LAICron: the
 * file on disk is always rewritten from this constant, so editing it by hand
 * has no effect on the next run.
 */
export const CRON_INSTRUCTIONS = [
  "Estás ejecutando una tarea programada por LAICron. No es una conversación:",
  "no habrá respuesta del usuario.",
  "- Ejecuta exactamente lo que pide el mensaje y termina.",
  "- No saludes, no pidas confirmación, no preguntes nada y no ofrezcas ayuda.",
  "- Responde solo con el resultado necesario, de forma concisa.",
  "- Si falta un dato imprescindible, dilo en una línea y termina.",
].join("\n");

const DATA_HOME_FALLBACK = join(homedir(), ".local", "share");

/**
 * Resolves the instruction file location, honouring `XDG_DATA_HOME` and falling
 * back to `~/.local/share` when it is unset or empty.
 */
export function cronInstructionsPath(): string {
  const dataHome = process.env.XDG_DATA_HOME;

  return join(
    dataHome !== undefined && dataHome.length > 0 ? dataHome : DATA_HOME_FALLBACK,
    "laicron",
    "prompts",
    "cron-system.md",
  );
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    // A missing file is the normal first-run case; anything else surfaces when
    // the write below fails and is reported as a null result.
    return null;
  }
}

/**
 * Ensures the instruction file exists with the expected content and returns its
 * path. It never throws: any filesystem error degrades to `null` so the caller
 * can run the job without the instruction.
 */
export async function ensureCronInstructions(): Promise<string | null> {
  const path = cronInstructionsPath();

  try {
    await mkdir(dirname(path), { recursive: true });

    if ((await readIfPresent(path)) !== CRON_INSTRUCTIONS) {
      await writeFile(path, CRON_INSTRUCTIONS, "utf8");
    }

    return path;
  } catch {
    return null;
  }
}
