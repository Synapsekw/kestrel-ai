import { createApiClient, type ApiClient } from "@contract/client";

/** Longest the UI waits for one backend answer. Pre-annotation and a first model import take tens of seconds. */
export const REQUEST_TIMEOUT_MS = 120_000;

/**
 * A `fetch` that gives up after `ms`. Without it a hung request never settles and everything queued
 * behind it (the editor's per-image command queue) waits forever with "Saving…".
 */
export function withTimeout(inner: typeof fetch, ms: number): typeof fetch {
  return (async (input: Request | string | URL, init?: RequestInit) => {
    const controller = new AbortController();
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const forward = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) forward();
    else callerSignal?.addEventListener("abort", forward, { once: true });

    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost");
    const timer = setTimeout(
      () =>
        controller.abort(
          new Error(`The backend did not answer within ${ms / 1000} s (${method} ${url.pathname}).`),
        ),
      ms,
    );
    try {
      return await inner(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", forward);
    }
  }) as typeof fetch;
}

/** The client the app talks to the backend with: every request is capped at `REQUEST_TIMEOUT_MS`. */
export function createBackendClient(opts: { baseUrl: string; token: string }): ApiClient {
  // Resolved per call, so the global `fetch` keeps its `this` and tests can replace it.
  const globalFetch: typeof fetch = (input, init) => fetch(input, init);
  return createApiClient({ ...opts, fetch: withTimeout(globalFetch, REQUEST_TIMEOUT_MS) });
}
