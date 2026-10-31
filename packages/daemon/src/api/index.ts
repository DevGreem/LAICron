import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import type { Engine, EngineEvent } from "@laicron/core";
import type {
  JobRepository,
  MessageRepository,
  MetaRepository,
  RunRepository,
} from "@laicron/core/db";

import {
  createOpencodeOptions,
  type OpencodeOptions,
  type OpencodeOptionsService,
} from "../opencode-options.js";
import { sendError, sendJson, sendKnownError } from "./errors.js";
import { handleJobsRoute } from "./jobs.js";
import { serveStatic } from "./static.js";

/** Everything the HTTP layer needs from the rest of the daemon. */
export interface ApiDeps {
  engine: Engine;
  jobs: JobRepository;
  runs: RunRepository;
  messages: MessageRepository;
  meta: MetaRepository;
  token: string;
  now?: () => number;
  uiRoot: string;
  version: string;
  opencodeOptions?: OpencodeOptionsService;
}

export interface ApiServer {
  /** Starts listening and resolves with the real port (useful with port 0). */
  start(port: number, host?: string): Promise<number>;
  stop(): Promise<void>;
}

const DEFAULT_HOST = "127.0.0.1";
const PING_INTERVAL_MS = 25_000;

interface SseClient {
  res: ServerResponse;
  interval: NodeJS.Timeout;
  close: () => void;
}

function serializeEvent(event: EngineEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Catalog failures must never become a 500: the form degrades to text inputs. */
async function readOpencodeOptions(
  service: OpencodeOptionsService,
  refresh: boolean,
): Promise<OpencodeOptions> {
  try {
    return await service.get(refresh);
  } catch {
    return {
      available: false,
      reason: "No se pudo leer el catálogo de opencode",
      models: [],
      agents: [],
    };
  }
}

function tokenMatches(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function isAuthorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization;
  if (typeof header !== "string") {
    return false;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const provided = match?.[1]?.trim();
  if (provided === undefined || provided.length === 0) {
    return false;
  }
  return tokenMatches(provided, token);
}

/** Builds the HTTP server; nothing is bound until `start` is called. */
export function createApiServer(deps: ApiDeps): ApiServer {
  const now = deps.now ?? Date.now;
  const sseClients = new Set<SseClient>();
  let server: Server | null = null;
  let startedAt = now();

  const jobDeps = {
    engine: deps.engine,
    jobs: deps.jobs,
    runs: deps.runs,
    messages: deps.messages,
    now,
  };

  const opencodeOptions = deps.opencodeOptions ?? createOpencodeOptions();

  const unsubscribe = deps.engine.onEvent((event) => {
    if (sseClients.size === 0) {
      return;
    }
    const frame = serializeEvent(event);
    for (const client of [...sseClients]) {
      try {
        client.res.write(frame);
      } catch {
        client.close();
      }
    }
  });

  function closeSseClients(): void {
    for (const client of [...sseClients]) {
      client.close();
      try {
        client.res.end();
      } catch {
        // The socket may already be gone; nothing else to release.
      }
    }
  }

  function attachSse(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    // Flush headers immediately so clients know the stream is open.
    res.write(": connected\n\n");

    const interval = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        client.close();
      }
    }, PING_INTERVAL_MS);

    const client: SseClient = {
      res,
      interval,
      close: () => {
        clearInterval(interval);
        sseClients.delete(client);
      },
    };

    sseClients.add(client);
    req.on("close", client.close);
    res.on("close", client.close);
    res.on("error", client.close);
  }

  function heartbeatAt(): number | null {
    const raw = deps.meta.get("heartbeat_at");
    if (raw === null || raw.trim().length === 0) {
      return null;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  function sendHealth(res: ServerResponse): void {
    sendJson(res, 200, {
      status: "ok",
      version: deps.version,
      uptimeMs: Math.max(0, now() - startedAt),
      heartbeatAt: heartbeatAt(),
    });
  }

  async function handleApi(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    method: string,
  ): Promise<void> {
    const segments = url.pathname.split("/").filter((segment) => segment.length > 0);

    if (segments.length === 2 && segments[1] === "events" && method === "GET") {
      attachSse(req, res);
      return;
    }

    const isOpencodeOptionsRoute =
      segments.length === 3 &&
      segments[0] === "api" &&
      segments[1] === "opencode" &&
      segments[2] === "options";

    if (isOpencodeOptionsRoute && method === "GET") {
      const refreshParam = url.searchParams.get("refresh");
      const refresh = refreshParam === "1" || refreshParam === "true";
      sendJson(res, 200, await readOpencodeOptions(opencodeOptions, refresh));
      return;
    }

    if (await handleJobsRoute(jobDeps, req, res, method, url, segments)) {
      return;
    }

    sendError(res, 404, "not_found", "Recurso no encontrado.");
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const method = req.method ?? "GET";
      const pathname = url.pathname;

      if (pathname === "/api/health" && method === "GET") {
        sendHealth(res);
        return;
      }

      if (pathname === "/api" || pathname.startsWith("/api/")) {
        if (!isAuthorized(req, deps.token)) {
          sendError(res, 401, "unauthorized", "Token no válido.");
          return;
        }
        await handleApi(req, res, url, method);
        return;
      }

      if (method === "GET") {
        serveStatic(res, deps.uiRoot, pathname);
        return;
      }

      sendError(res, 404, "not_found", "Recurso no encontrado.");
    } catch (error) {
      if (res.headersSent || res.writableEnded || res.destroyed) {
        res.destroy();
        return;
      }
      if (!sendKnownError(res, error)) {
        sendError(res, 500, "internal_error", "Error interno del servidor.");
      }
    }
  }

  async function start(port: number, host: string = DEFAULT_HOST): Promise<number> {
    if (server !== null) {
      throw new Error("El servidor HTTP ya está en marcha.");
    }

    const httpServer = createServer((req, res) => {
      void handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        httpServer.off("listening", onListening);
        reject(error);
      };
      const onListening = (): void => {
        httpServer.off("error", onError);
        resolve();
      };
      httpServer.once("error", onError);
      httpServer.once("listening", onListening);
      httpServer.listen(port, host);
    });

    server = httpServer;
    startedAt = now();

    const address = httpServer.address();
    if (address === null || typeof address === "string") {
      throw new Error("El servidor HTTP no expuso un puerto TCP.");
    }
    return address.port;
  }

  async function stop(): Promise<void> {
    closeSseClients();
    unsubscribe();

    const current = server;
    server = null;
    if (current === null) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      current.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
      // Do not let idle keep-alive or lingering SSE sockets delay shutdown.
      current.closeAllConnections();
    });
  }

  return { start, stop };
}
