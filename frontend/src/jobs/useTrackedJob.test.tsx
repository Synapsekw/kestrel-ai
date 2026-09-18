import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { errorBody, fakeClient, JOB_ID, PROJECT_ID, runningJob } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { JOB_POLL_MAX_FAILURES, JOB_POLL_MS, useTrackedJob } from "./useTrackedJob";

function wrapperFor(api: ReturnType<typeof fakeClient>["api"]) {
  return ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
}

/** Lets the fake fetch settle and then fires `ticks` poll intervals. */
async function advance(ticks: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  for (let i = 0; i < ticks; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(JOB_POLL_MS);
    });
  }
}

describe("useTrackedJob", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("fetches an unknown job into the store and returns it", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /\/jobs\/[^/]+$/, body: runningJob }]);
    const { result } = renderHook(() => useTrackedJob(PROJECT_ID, JOB_ID), { wrapper: wrapperFor(api) });
    expect(result.current.job).toBeNull();
    await waitFor(() => expect(result.current.job?.progress).toBe(0.42));
    expect(result.current.error).toBeNull();
    expect(requests[0].url).toBe(`/api/v1/projects/${PROJECT_ID}/jobs/${JOB_ID}`);
    expect(useJobsStore.getState().jobs[JOB_ID].state).toBe("running");
  });

  it("does not poll a finished job", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /\/jobs\/[^/]+$/, body: runningJob }]);
    useJobsStore
      .getState()
      .upsert({ ...runningJob, state: "succeeded", finished_at: "2026-09-17T11:00:00Z" });
    const { result } = renderHook(() => useTrackedJob(PROJECT_ID, JOB_ID), { wrapper: wrapperFor(api) });
    expect(result.current.job?.state).toBe("succeeded");
    await new Promise((r) => setTimeout(r, 20));
    expect(requests).toHaveLength(0);
  });

  describe("giving up", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("stops after one 404 and reports that the job is unknown", async () => {
      const { api, requests } = fakeClient([
        {
          method: "GET",
          path: /\/jobs\/[^/]+$/,
          status: 404,
          body: errorBody("not_found", "job j1 not found"),
        },
      ]);
      const { result } = renderHook(() => useTrackedJob(PROJECT_ID, JOB_ID), { wrapper: wrapperFor(api) });
      await advance(5);
      expect(result.current.error).toBe("job j1 not found");
      expect(result.current.job).toBeNull();
      expect(requests).toHaveLength(1);
    });

    it("retries other failures and gives up after the limit", async () => {
      const { api, requests } = fakeClient([
        {
          method: "GET",
          path: /\/jobs\/[^/]+$/,
          status: 500,
          body: errorBody("internal_error", "db locked"),
        },
      ]);
      const { result } = renderHook(() => useTrackedJob(PROJECT_ID, JOB_ID), { wrapper: wrapperFor(api) });
      await advance(1);
      expect(requests).toHaveLength(2);
      expect(result.current.error).toBeNull();
      await advance(JOB_POLL_MAX_FAILURES + 3);
      expect(requests).toHaveLength(JOB_POLL_MAX_FAILURES);
      expect(result.current.error).toBe("db locked");
    });
  });
});
