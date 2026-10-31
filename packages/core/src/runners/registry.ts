import type { Runner, RunnerKind, RunnerRegistry } from "../types.js";
import { createOpencodeRunner } from "./opencode.js";
import { createShellRunner } from "./shell.js";

export function createRunnerRegistry(): RunnerRegistry {
  const runners: Record<RunnerKind, Runner> = {
    shell: createShellRunner(),
    opencode: createOpencodeRunner(),
  };

  return {
    get(kind: RunnerKind): Runner {
      return runners[kind];
    },
  };
}
