import { readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";

import { sendError } from "./errors.js";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function notFound(res: ServerResponse): void {
  sendError(res, 404, "not_found", "Recurso no encontrado.");
}

/**
 * Serves a file from the UI build directory. Paths are resolved before being
 * checked so encoded traversal (`..%2F..%2Fetc`) cannot escape the root.
 */
export function serveStatic(res: ServerResponse, uiRoot: string, pathname: string): void {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    notFound(res);
    return;
  }

  const root = resolve(uiRoot);
  const relative = decoded.replace(/^\/+/, "");
  const target = relative.length === 0 ? resolve(root, "index.html") : resolve(root, relative);
  const rootPrefix = root.endsWith(sep) ? root : root + sep;

  if (!target.startsWith(rootPrefix)) {
    notFound(res);
    return;
  }

  let data: Buffer;
  try {
    data = readFileSync(target);
  } catch {
    notFound(res);
    return;
  }

  const contentType = CONTENT_TYPES[extname(target).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, {
    "content-type": contentType,
    "content-length": data.length,
  });
  res.end(data);
}
