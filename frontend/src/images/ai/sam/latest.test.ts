import { describe, expect, it, vi } from "vitest";
import { LatestOnly } from "./latest";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("LatestOnly", () => {
  it("keeps one request in flight and sends only the newest queued value", async () => {
    const calls: number[] = [];
    const gates = [deferred<number>(), deferred<number>()];
    const onResult = vi.fn();
    const q = new LatestOnly<number, number>(
      (v) => {
        calls.push(v);
        return gates[calls.length - 1].promise;
      },
      onResult,
      vi.fn(),
    );
    q.submit(1);
    q.submit(2);
    q.submit(3);
    expect(calls).toEqual([1]);
    gates[0].resolve(10);
    await vi.waitFor(() => expect(calls).toEqual([1, 3]));
    gates[1].resolve(30);
    await vi.waitFor(() => expect(onResult).toHaveBeenLastCalledWith(30, 3));
    expect(onResult).toHaveBeenCalledTimes(2);
  });

  it("drops results after reset", async () => {
    const gate = deferred<number>();
    const onResult = vi.fn();
    const q = new LatestOnly<number, number>(() => gate.promise, onResult, vi.fn());
    q.submit(1);
    q.reset();
    gate.resolve(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(onResult).not.toHaveBeenCalled();
  });
});
