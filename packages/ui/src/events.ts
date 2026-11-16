import { t } from "./i18n.js";

/** SSE client built on `fetch` so the Authorization header can be sent. */

export type SseHandler = (type: string, data: unknown) => void;

interface SseFrame {
  event: string;
  data: string;
}

interface ConnectOptions {
  retryMs?: number;
  onConnectionChange?: (connected: boolean) => void;
}

function parseFrame(frame: string): SseFrame | null {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of frame.split("\n")) {
    if (line.length === 0 || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }
  return { event, data: dataLines.join("\n") };
}

/**
 * Opens `/api/events` with the bearer token, dispatching parsed events to
 * `handler`. Reconnects every `retryMs` (5 s by default) until disposed.
 */
export function connectEvents(
  token: string,
  handler: SseHandler,
  options: ConnectOptions = {},
): () => void {
  const retryMs = options.retryMs ?? 5000;
  let stopped = false;
  let connected = false;
  let controller: AbortController | null = null;
  let retryTimer: number | null = null;

  function setConnected(value: boolean): void {
    if (connected === value) {
      return;
    }
    connected = value;
    options.onConnectionChange?.(value);
  }

  function scheduleRetry(): void {
    if (stopped) {
      return;
    }
    setConnected(false);
    retryTimer = window.setTimeout(() => {
      retryTimer = null;
      void run();
    }, retryMs);
  }

  async function run(): Promise<void> {
    if (stopped) {
      return;
    }

    controller = new AbortController();
    try {
      const response = await fetch("/api/events", {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "text/event-stream",
        },
        cache: "no-store",
        signal: controller.signal,
      });

      if (!response.ok || response.body === null) {
        throw new Error(t("events.openFailed", { status: response.status }));
      }

      setConnected(true);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!stopped) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        buffer += decoder.decode(chunk.value, { stream: true });

        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const frame = parseFrame(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          if (frame !== null) {
            let data: unknown = frame.data;
            try {
              data = JSON.parse(frame.data) as unknown;
            } catch {
              // Keep the raw text; handlers only need the event type in that case.
            }
            handler(frame.event, data);
          }
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch (error) {
      if (stopped || (error instanceof DOMException && error.name === "AbortError")) {
        return;
      }
    } finally {
      controller = null;
      if (!stopped) {
        scheduleRetry();
      }
    }
  }

  void run();

  return () => {
    stopped = true;
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer);
      retryTimer = null;
    }
    controller?.abort();
    setConnected(false);
  };
}
