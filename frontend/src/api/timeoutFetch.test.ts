import { describe, it, expect, vi, afterEach } from "vitest";
import { withTimeout } from "./timeoutFetch";

afterEach(() => vi.useRealTimers());

/** A fetch that only settles when its signal aborts, like a hung backend request. */
const hanging: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted")));
  });

describe("withTimeout", () => {
  it("fails a request the backend never answers, with a message for the operator", async () => {
    vi.useFakeTimers();
    const pending = withTimeout(hanging, 120_000)("http://x/api/v1/projects/p/boxes/b", { method: "PATCH" });
    const settled = expect(pending).rejects.toThrow(
      "The backend did not answer within 120 s (PATCH /api/v1/projects/p/boxes/b).",
    );
    await vi.advanceTimersByTimeAsync(120_000);
    await settled;
  });

  it("passes answers through and leaves no timer behind", async () => {
    vi.useFakeTimers();
    const ok: typeof fetch = () => Promise.resolve(new Response("{}", { status: 200 }));
    const res = await withTimeout(ok, 1000)("http://x/y");
    expect(res.status).toBe(200);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("still honours the caller's own abort signal", async () => {
    const controller = new AbortController();
    const pending = withTimeout(hanging, 1000)("http://x/y", { signal: controller.signal });
    controller.abort(new Error("navigated away"));
    await expect(pending).rejects.toThrow("navigated away");
  });
});

describe("createBackendClient", () => {
  it("builds the app's API client on the timeout fetch", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hanging);
    try {
      const { createBackendClient } = await import("./timeoutFetch");
      const client = createBackendClient({ baseUrl: "http://127.0.0.1:1", token: "t" });
      const pending = client.GET("/api/v1/projects");
      const settled = expect(pending).rejects.toThrow(
        /did not answer within 120 s \(GET \/api\/v1\/projects\)/,
      );
      await vi.advanceTimersByTimeAsync(120_000);
      await settled;
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
