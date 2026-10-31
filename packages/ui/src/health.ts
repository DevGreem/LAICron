import { fetchHealth } from "./api.js";

const POLL_INTERVAL_MS = 10_000;
const MAX_HEARTBEAT_AGE_MS = 60_000;

/**
 * Polls the public health endpoint every 10 s. A failed request or a stale
 * heartbeat (older than 60 s) means the scheduler is not responding. A missing
 * heartbeat is tolerated during the first minute of uptime.
 */
export function startHealthMonitor(onChange: (healthy: boolean) => void): () => void {
  let stopped = false;
  let last: boolean | null = null;
  let timer: number | null = null;

  async function check(): Promise<void> {
    let healthy = false;
    try {
      const health = await fetchHealth();
      const heartbeatFresh =
        health.heartbeatAt !== null && Date.now() - health.heartbeatAt <= MAX_HEARTBEAT_AGE_MS;
      const startingUp = health.heartbeatAt === null && health.uptimeMs <= MAX_HEARTBEAT_AGE_MS;
      healthy = health.status === "ok" && (heartbeatFresh || startingUp);
    } catch {
      healthy = false;
    }

    if (stopped || last === healthy) {
      return;
    }
    last = healthy;
    onChange(healthy);
  }

  void check();
  timer = window.setInterval(() => {
    void check();
  }, POLL_INTERVAL_MS);

  return () => {
    stopped = true;
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}
