import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = new URL(".", import.meta.url);

export default defineConfig({
  resolve: {
    alias: [
      // Order matters: subpaths must come before the bare package alias.
      {
        find: "@laicron/core/db",
        replacement: fileURLToPath(new URL("packages/core/src/db/index.ts", repoRoot)),
      },
      {
        find: "@laicron/core/schedule",
        replacement: fileURLToPath(new URL("packages/core/src/schedule/index.ts", repoRoot)),
      },
      {
        find: "@laicron/core/runners",
        replacement: fileURLToPath(new URL("packages/core/src/runners/index.ts", repoRoot)),
      },
      {
        find: "@laicron/core/engine",
        replacement: fileURLToPath(new URL("packages/core/src/engine/index.ts", repoRoot)),
      },
      {
        find: "@laicron/core/clock",
        replacement: fileURLToPath(new URL("packages/core/src/clock/index.ts", repoRoot)),
      },
      {
        find: "@laicron/core/notifications",
        replacement: fileURLToPath(new URL("packages/core/src/notifications/index.ts", repoRoot)),
      },
      {
        find: "@laicron/core",
        replacement: fileURLToPath(new URL("packages/core/src/index.ts", repoRoot)),
      },
    ],
  },
  test: {
    include: ["packages/**/test/**/*.test.ts"],
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
