import type { ReactNode } from "react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { Job } from "@contract/client";
import { JobsButton } from "@/jobs/JobsButton";
import { useJobsStore } from "@/store/jobs";
import { fakeClient, runningJob } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useLibraryJobs } from "./useLibraryJobs";

function wrapperFor(api: ReturnType<typeof fakeClient>["api"]) {
  return ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
}

const importJob: Job = {
  ...runningJob,
  id: "j-lib-1",
  project_id: "library",
  type: "library_import",
  params: { name: "client-x" },
};

describe("useLibraryJobs", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("upserts library jobs into the store so the jobs button counts them", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/library\/jobs$/, body: { items: [importJob], next_cursor: null } },
    ]);
    renderHook(() => useLibraryJobs(undefined, { intervalMs: 20 }), { wrapper: wrapperFor(api) });
    render(<JobsButton />);
    await waitFor(() => expect(useJobsStore.getState().jobs[importJob.id]).toBeDefined());
    expect(screen.getByRole("button", { name: "1 active job" })).toBeInTheDocument();
  });

  it("polls while a job runs and reports each finished job once", async () => {
    let calls = 0;
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/library\/jobs$/,
        body: () => {
          calls += 1;
          const job =
            calls < 3
              ? importJob
              : { ...importJob, state: "succeeded", progress: 1, result: { model_id: "m-new" } };
          return { items: [job], next_cursor: null };
        },
      },
    ]);
    const onFinished = vi.fn();
    const { result } = renderHook(() => useLibraryJobs(onFinished, { intervalMs: 20 }), {
      wrapper: wrapperFor(api),
    });
    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
    expect(onFinished.mock.calls[0][0]).toMatchObject({ id: importJob.id, state: "succeeded" });
    const settled = calls;
    await new Promise((r) => setTimeout(r, 80));
    // Nothing is running any more: the poller stopped and the callback did not fire again.
    expect(calls).toBe(settled);
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(result.current.jobs.map((j) => j.state)).toEqual(["succeeded"]);
  });

  it("track() starts polling again for a job started on this screen", async () => {
    let queued = false;
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/library\/jobs$/,
        body: () => ({
          items: queued ? [{ ...importJob, state: "failed", error: "not a YOLO file" }] : [],
          next_cursor: null,
        }),
      },
    ]);
    const onFinished = vi.fn();
    const { result } = renderHook(() => useLibraryJobs(onFinished, { intervalMs: 20 }), {
      wrapper: wrapperFor(api),
    });
    await waitFor(() => expect(requests).toHaveLength(1));
    act(() => {
      queued = true;
      result.current.track(importJob);
    });
    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
    expect(onFinished.mock.calls[0][0]).toMatchObject({ state: "failed", error: "not a YOLO file" });
  });
});
