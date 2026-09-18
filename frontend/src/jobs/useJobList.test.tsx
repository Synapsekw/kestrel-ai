import type { ReactNode } from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { errorBody, fakeClient, JOB_ID, PROJECT_ID, runningJob } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { useInitialJobs } from "./useJobList";

function wrapperFor(api: ReturnType<typeof fakeClient>["api"]) {
  return ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
}

describe("useInitialJobs", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("loads the project's jobs into the store once, so the counter is right before the panel opens", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/jobs$/, body: { items: [runningJob], next_cursor: null } },
    ]);
    renderHook(() => useInitialJobs(PROJECT_ID), { wrapper: wrapperFor(api) });
    await waitFor(() => expect(useJobsStore.getState().jobs[JOB_ID]).toBeDefined());
    expect(useJobsStore.getState().active()).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(`/api/v1/projects/${PROJECT_ID}/jobs?limit=100`);
  });

  it("stays quiet without a project and tolerates a failing list", async () => {
    const none = fakeClient([]);
    renderHook(() => useInitialJobs(""), { wrapper: wrapperFor(none.api) });
    await new Promise((r) => setTimeout(r, 10));
    expect(none.requests).toHaveLength(0);

    const failing = fakeClient([
      { method: "GET", path: /\/jobs$/, status: 501, body: errorBody("not_implemented", "later") },
    ]);
    renderHook(() => useInitialJobs(PROJECT_ID), { wrapper: wrapperFor(failing.api) });
    await waitFor(() => expect(failing.requests).toHaveLength(1));
    expect(useJobsStore.getState().jobs).toEqual({});
  });
});
