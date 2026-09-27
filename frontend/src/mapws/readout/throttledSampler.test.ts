import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createThrottledSampler } from "./throttledSampler";

describe("createThrottledSampler (M §13)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("samples at once, then at most once per 150 ms with the latest point", async () => {
    const sample = vi.fn(async (x: number) => x);
    const onResult = vi.fn();
    const s = createThrottledSampler({ intervalMs: 150, sample, onResult });
    for (let i = 0; i < 10; i++) {
      s.push(i, 0);
      vi.advanceTimersByTime(10);
    }
    expect(sample).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(150);
    expect(sample).toHaveBeenCalledTimes(2);
    expect(sample.mock.calls[1][0]).toBe(9);
    expect(onResult).toHaveBeenLastCalledWith(9);
  });

  it("keeps one request in flight: a newer sample aborts the older and its answer is dropped", async () => {
    const signals: AbortSignal[] = [];
    let resolveFirst: (z: number) => void = () => {};
    const sample = vi.fn((_x: number, _y: number, signal: AbortSignal) => {
      signals.push(signal);
      return signals.length === 1 ? new Promise<number>((res) => (resolveFirst = res)) : Promise.resolve(2);
    });
    const onResult = vi.fn();
    const s = createThrottledSampler({ intervalMs: 150, sample, onResult });
    s.push(1, 1);
    await vi.advanceTimersByTimeAsync(200);
    s.push(2, 2);
    await vi.advanceTimersByTimeAsync(0);
    expect(signals[0].aborted).toBe(true);
    resolveFirst(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(2);
  });

  it("reports null on a failed sample and nothing after cancel", async () => {
    const onResult = vi.fn();
    const s = createThrottledSampler({
      intervalMs: 150,
      sample: () => Promise.reject(new Error("500")),
      onResult,
    });
    s.push(0, 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(onResult).toHaveBeenCalledWith(null);
    s.cancel();
    s.push(1, 1);
    await vi.advanceTimersByTimeAsync(300);
    expect(onResult).toHaveBeenCalledTimes(1);
  });
});
