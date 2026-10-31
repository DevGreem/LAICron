import { describe, expect, it } from "vitest";

import { Semaphore } from "../../src/engine/semaphore.js";

function abortedController(reason = "cancelled"): AbortController {
  const controller = new AbortController();
  controller.abort(reason);
  return controller;
}

describe("Semaphore", () => {
  it("grants slots in FIFO order", async () => {
    const semaphore = new Semaphore(1);
    const order: string[] = [];

    await semaphore.acquire();
    expect(semaphore.active).toBe(1);

    const second = semaphore.acquire().then(() => {
      order.push("second");
    });
    const third = semaphore.acquire().then(() => {
      order.push("third");
    });
    expect(semaphore.pending).toBe(2);

    semaphore.release();
    await second;
    expect(order).toEqual(["second"]);
    expect(semaphore.active).toBe(1);

    semaphore.release();
    await third;
    expect(order).toEqual(["second", "third"]);
    expect(semaphore.active).toBe(1);

    semaphore.release();
    expect(semaphore.active).toBe(0);
  });

  it("rejects an acquire whose signal was already aborted", async () => {
    const semaphore = new Semaphore(1);
    const controller = abortedController("before");

    await expect(semaphore.acquire(controller.signal)).rejects.toBe("before");
    expect(semaphore.active).toBe(0);
    expect(semaphore.pending).toBe(0);
  });

  it("removes an aborted waiter without consuming a slot or blocking the queue", async () => {
    const semaphore = new Semaphore(1);
    await semaphore.acquire();

    const controller = new AbortController();
    const aborted = semaphore.acquire(controller.signal);
    const third = semaphore.acquire();

    expect(semaphore.pending).toBe(2);
    controller.abort("cancelada");
    await expect(aborted).rejects.toBe("cancelada");
    expect(semaphore.pending).toBe(1);

    semaphore.release();
    await third;
    expect(semaphore.active).toBe(1);

    semaphore.release();
    expect(semaphore.active).toBe(0);
  });

  it("keeps the freed slot for a live waiter when the first one aborted", async () => {
    const semaphore = new Semaphore(1);
    await semaphore.acquire();

    const controller = new AbortController();
    const aborted = semaphore.acquire(controller.signal);
    const live = semaphore.acquire();

    // Abort without awaiting the rejection first, then release in the same turn.
    controller.abort("cancelada");
    semaphore.release();

    await expect(aborted).rejects.toBe("cancelada");
    await live;
    expect(semaphore.active).toBe(1);
    expect(semaphore.pending).toBe(0);

    semaphore.release();
  });
});
