import { t } from "../i18n.js";

/**
 * Minimal FIFO semaphore used to cap concurrent AI executions.
 *
 * Waiters are granted slots in arrival order. A waiter whose signal aborts
 * before it gets a slot is removed from the queue without consuming capacity
 * and without blocking the waiters behind it.
 */

interface Waiter {
  resolve: () => void;
  reject: (reason: unknown) => void;
  signal: AbortSignal | undefined;
  onAbort: (() => void) | undefined;
}

function abortReason(signal: AbortSignal): unknown {
  const reason: unknown = signal.reason;
  return reason ?? new Error(t("engine.cancelled"));
}

function detachAbortListener(waiter: Waiter): void {
  if (waiter.onAbort !== undefined && waiter.signal !== undefined) {
    waiter.signal.removeEventListener("abort", waiter.onAbort);
  }
}

export class Semaphore {
  private activeCount = 0;
  private readonly waiters: Waiter[] = [];

  constructor(private readonly limit: number) {}

  /** Slots currently held. */
  get active(): number {
    return this.activeCount;
  }

  /** Executions waiting for a slot. */
  get pending(): number {
    return this.waiters.length;
  }

  /**
   * Reserves a slot. Resolves immediately while capacity is available and
   * waits in FIFO order otherwise. Rejects with the signal reason when the
   * signal aborts before the slot is granted; in that case no slot is held.
   */
  acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted === true) {
      return Promise.reject(abortReason(signal));
    }

    if (this.activeCount < this.limit) {
      this.activeCount += 1;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal, onAbort: undefined };

      if (signal !== undefined) {
        waiter.onAbort = () => {
          const index = this.waiters.indexOf(waiter);
          if (index !== -1) {
            this.waiters.splice(index, 1);
          }
          reject(abortReason(signal));
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }

      this.waiters.push(waiter);
    });
  }

  /** Frees a slot and hands it to the next live waiter, if any. */
  release(): void {
    if (this.activeCount === 0) {
      return;
    }

    this.activeCount -= 1;
    this.grantNext();
  }

  private grantNext(): void {
    while (this.activeCount < this.limit) {
      const waiter = this.waiters.shift();
      if (waiter === undefined) {
        return;
      }

      detachAbortListener(waiter);

      if (waiter.signal?.aborted === true) {
        waiter.reject(abortReason(waiter.signal));
        continue;
      }

      this.activeCount += 1;
      waiter.resolve();
    }
  }
}
