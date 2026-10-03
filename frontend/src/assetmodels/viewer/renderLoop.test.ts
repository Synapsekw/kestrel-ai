import { describe, expect, it } from "vitest";
import { createOnDemandLoop } from "./renderLoop";

describe("on-demand render loop", () => {
  it("queues one follow-up frame when update asks to render again", () => {
    const now = 0;
    const queued: Array<() => void> = [];
    let paints = 0;
    const loop = createOnDemandLoop({
      now: () => now,
      requestFrame(cb) {
        queued.push(cb);
        return queued.length;
      },
      cancelFrame() {},
      update() {
        loop.request();
      },
      render() {
        paints += 1;
      },
      holdMs: 1000,
    });

    loop.request();
    expect(queued).toHaveLength(1);
    const first = queued[0];
    queued.length = 0;
    first();

    expect(paints).toBe(1);
    expect(queued).toHaveLength(1);
  });

  it("collapses repeated render requests into one frame", () => {
    const queued: Array<() => void> = [];
    const loop = createOnDemandLoop({
      now: () => 0,
      requestFrame(cb) {
        queued.push(cb);
        return queued.length;
      },
      cancelFrame() {},
      update() {},
      render() {},
      holdMs: 1000,
    });

    loop.request();
    loop.request();

    expect(queued).toHaveLength(1);
  });

  it("does not keep painting once the hold has elapsed", () => {
    let now = 0;
    const queued: Array<() => void> = [];
    const loop = createOnDemandLoop({
      now: () => now,
      requestFrame(cb) {
        queued.push(cb);
        return queued.length;
      },
      cancelFrame() {},
      update() {},
      render() {},
      holdMs: 1000,
    });

    loop.request();
    now = 1000;
    queued[0]();

    expect(queued).toHaveLength(1);
  });

  it("dispose cancels the queued frame and ignores later requests", () => {
    const queued: Array<() => void> = [];
    const cancelled: number[] = [];
    const loop = createOnDemandLoop({
      now: () => 0,
      requestFrame(cb) {
        queued.push(cb);
        return 7;
      },
      cancelFrame(id) {
        cancelled.push(id);
      },
      update() {},
      render() {},
      holdMs: 1000,
    });

    loop.request();
    loop.dispose();
    loop.request();

    expect(cancelled).toEqual([7]);
    expect(queued).toHaveLength(1);
  });
});
