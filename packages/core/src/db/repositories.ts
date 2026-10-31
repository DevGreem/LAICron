import type { DatabaseSync } from "node:sqlite";

import { createJobRepository } from "./jobs.js";
import { createMessageRepository } from "./messages.js";
import { createMetaRepository } from "./meta.js";
import type { Repositories } from "./repository-types.js";
import { createRunRepository } from "./runs.js";

/** Builds every repository on top of a single database handle. */
export function createRepositories(db: DatabaseSync): Repositories {
  return {
    jobs: createJobRepository(db),
    runs: createRunRepository(db),
    messages: createMessageRepository(db),
    meta: createMetaRepository(db),
  };
}
