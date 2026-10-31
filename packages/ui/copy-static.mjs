import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const publicDir = join(packageRoot, "public");
const outDir = join(packageRoot, "dist");

await mkdir(outDir, { recursive: true });

for (const file of ["index.html", "styles.css"]) {
  await copyFile(join(publicDir, file), join(outDir, file));
}
