import type { ReactNode } from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { fakeClient, JOB_ID, PROJECT_ID, runningJob } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { useTrackedJob } from "./useTrackedJob";

describe("useTrackedJob", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("fetches an unknown job into the store and returns it", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /\/jobs\/[^/]+$/, body: runningJob }]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>{children}</TestApiProvider>
    );
    const { result } = renderHook(() => useTrackedJob(PROJECT_ID, JOB_ID), { wrapper });
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current?.progress).toBe(0.42));
    expect(requests[0].url).toBe(`/api/v1/projects/${PROJECT_ID}/jobs/${JOB_ID}`);
    expect(useJobsStore.getState().jobs[JOB_ID].state).toBe("running");
  });

  it("does not poll a finished job", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /\/jobs\/[^/]+$/, body: runningJob }]);
    useJobsStore
      .getState()
      .upsert({ ...runningJob, state: "succeeded", finished_at: "2026-09-17T11:00:00Z" });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>{children}</TestApiProvider>
    );
    const { result } = renderHook(() => useTrackedJob(PROJECT_ID, JOB_ID), { wrapper });
    expect(result.current?.state).toBe("succeeded");
    await new Promise((r) => setTimeout(r, 20));
    expect(requests).toHaveLength(0);
  });
});
