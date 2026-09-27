import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { THUMB_MAX_IN_FLIGHT, ThumbLoader, useThumb } from "./thumbs";

function deferredFetch() {
  const started: { url: string; signal: AbortSignal; resolve: () => void; reject: (e: unknown) => void }[] =
    [];
  const fetchBlob = vi.fn(
    (url: string, signal: AbortSignal) =>
      new Promise<Blob>((resolve, reject) => {
        started.push({ url, signal, resolve: () => resolve(new Blob(["x"])), reject });
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
  );
  let n = 0;
  const revokeUrl = vi.fn();
  const loader = new ThumbLoader({ fetchBlob, createUrl: () => `blob:${++n}`, revokeUrl, cacheMax: 3 });
  return { loader, started, fetchBlob, revokeUrl };
}

const quiet = (p: Promise<unknown>) => p.catch(() => undefined);

describe("ThumbLoader", () => {
  it("caps in-flight requests at 8 and starts the next as one finishes", async () => {
    const { loader, started } = deferredFetch();
    const ac = new AbortController();
    const all = Array.from({ length: 20 }, (_, i) => quiet(loader.load(`u${i}`, ac.signal)));
    expect(THUMB_MAX_IN_FLIGHT).toBe(8);
    expect(loader.inFlight).toBe(8);
    expect(loader.queued).toBe(12);
    await act(async () => {
      started[0].resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(loader.inFlight).toBe(8);
    expect(started).toHaveLength(9);
    ac.abort();
    await Promise.all(all);
  });

  it("an aborted queued request is never fetched", async () => {
    const { loader, started } = deferredFetch();
    const keep = new AbortController();
    for (let i = 0; i < 8; i++) void quiet(loader.load(`busy${i}`, keep.signal));
    const gone = new AbortController();
    const p = loader.load("scrolled-away", gone.signal);
    gone.abort();
    await expect(p).rejects.toThrow();
    expect(loader.queued).toBe(0);
    await act(async () => {
      for (const s of started) s.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(started.map((s) => s.url)).not.toContain("scrolled-away");
  });

  it("aborting an in-flight request frees its slot", async () => {
    const { loader, started } = deferredFetch();
    const ac = new AbortController();
    const p = loader.load("a", ac.signal);
    ac.abort();
    await expect(p).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 0)); // the slot is freed in `finally`, a tick later
    expect(started[0].signal.aborted).toBe(true);
    expect(loader.inFlight).toBe(0);
  });

  it("serves a loaded url from the cache and revokes evicted urls", async () => {
    const { loader, started, fetchBlob, revokeUrl } = deferredFetch();
    const ac = new AbortController();
    for (const u of ["a", "b", "c", "d"]) {
      const p = loader.load(u, ac.signal);
      started[started.length - 1].resolve();
      await p;
    }
    expect(fetchBlob).toHaveBeenCalledTimes(4);
    expect(revokeUrl).toHaveBeenCalledWith("blob:1"); // "a" evicted (cacheMax 3)
    expect(loader.peek("d")).toBe("blob:4");
    await expect(loader.load("d", ac.signal)).resolves.toBe("blob:4");
    expect(fetchBlob).toHaveBeenCalledTimes(4);
  });
});

describe("useThumb", () => {
  it("loads, and aborts when the tile unmounts", async () => {
    const { loader, started } = deferredFetch();
    const { result, unmount } = renderHook(() => useThumb("u1", loader));
    expect(result.current).toEqual({ src: null, failed: false });
    expect(started).toHaveLength(1);
    unmount();
    expect(started[0].signal.aborted).toBe(true);
  });

  it("shows the cached url at once and reports failures", async () => {
    const { loader, started } = deferredFetch();
    const first = renderHook(() => useThumb("u1", loader));
    await act(async () => {
      started[0].resolve();
    });
    await waitFor(() => expect(first.result.current.src).toBe("blob:1"));
    const second = renderHook(() => useThumb("u1", loader));
    expect(second.result.current.src).toBe("blob:1");
    const broken = renderHook(() => useThumb("u2", loader));
    await act(async () => {
      started[1].reject(new Error("404"));
    });
    await waitFor(() => expect(broken.result.current.failed).toBe(true));
  });
});
