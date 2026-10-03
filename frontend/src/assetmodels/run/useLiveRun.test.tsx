import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestApiProvider } from "@/test/render";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { RUN_POLL_MAX_FAILURES, RUN_POLL_MS, useLiveRun } from "./useLiveRun";

const running = {
  id: "r1",
  state: "running",
  phase: "building",
  steps: [],
  usage: { input_tokens: 0, output_tokens: 0 },
};
const done = { ...running, state: "finished", phase: "done" };

function setup(routes: Parameters<typeof fakeClient>[0], id: string | null = "r1") {
  const { api, requests } = fakeClient(routes);
  const hook = renderHook(({ runId }) => useLiveRun(PROJECT_ID, "m1", runId), {
    initialProps: { runId: id },
    wrapper: ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>{children}</TestApiProvider>
    ),
  });
  return { ...hook, requests };
}

describe("useLiveRun", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("polls while running and stops when the run ends", async () => {
    let n = 0;
    const { result, requests } = setup([
      { method: "GET", path: /\/runs\/r1$/, body: () => (n++ < 1 ? running : done) },
    ]);
    await waitFor(() => expect(result.current.run?.state).toBe("running"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RUN_POLL_MS);
    });
    await waitFor(() => expect(result.current.run?.state).toBe("finished"));
    const count = requests.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RUN_POLL_MS * 3);
    });
    expect(requests.length).toBe(count);
  });

  it("gives up after consecutive failures and exposes error", async () => {
    const { result, requests } = setup([
      {
        method: "GET",
        path: /\/runs\/r1$/,
        status: 500,
        body: { error: { code: "boom", message: "down", details: {} } },
      },
    ]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RUN_POLL_MS * 2 * RUN_POLL_MAX_FAILURES);
    });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(requests.length).toBe(RUN_POLL_MAX_FAILURES);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RUN_POLL_MS * 10);
    });
    expect(requests.length).toBe(RUN_POLL_MAX_FAILURES);
  });

  it("clears the run and stops polling when the run id goes away", async () => {
    const { result, rerender, requests } = setup([
      { method: "GET", path: /\/runs\/r1$/, body: running },
      {
        method: "GET",
        path: /\/runs\/r2$/,
        status: 500,
        body: { error: { code: "x", message: "no", details: {} } },
      },
    ]);
    await waitFor(() => expect(result.current.run?.id).toBe("r1"));
    rerender({ runId: null });
    expect(result.current.run).toBeNull();
    const count = requests.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RUN_POLL_MS * 3);
    });
    expect(requests.length).toBe(count);
  });

  it("stop posts to the stop route and updates the run", async () => {
    const { result, requests } = setup([
      { method: "GET", path: /\/runs\/r1$/, body: running },
      { method: "POST", path: /\/runs\/r1\/stop$/, body: { ...done, state: "stopped", stop_reason: "user" } },
    ]);
    await waitFor(() => expect(result.current.run?.state).toBe("running"));
    await act(async () => {
      await result.current.stop();
    });
    expect(requests.some((r) => r.method === "POST" && r.url.endsWith("/runs/r1/stop"))).toBe(true);
    expect(result.current.run?.state).toBe("stopped");
    expect(result.current.stopping).toBe(false);
  });
});
