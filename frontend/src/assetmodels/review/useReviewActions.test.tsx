// src/assetmodels/review/useReviewActions.test.tsx
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { TestApiProvider } from "@/test/render";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { useJobsStore } from "@/store/jobs";
import { useToastStore } from "@/ui";
import { useReviewActions } from "./useReviewActions";

const job = (type: string, state = "queued") => ({
  id: `j-${type}`,
  project_id: PROJECT_ID,
  type,
  state,
  progress: 0,
  message: "",
  log_path: "",
  params: { asset_model_id: "m1" },
  result: null,
  error: null,
  created_at: "",
  started_at: null,
  finished_at: null,
});

afterEach(() => useJobsStore.setState({ jobs: {} }));

describe("useReviewActions", () => {
  it("posts each job, tracks it in the jobs store and says it started", async () => {
    const { api } = fakeClient([
      { method: "POST", path: /\/placements\/compute$/, status: 202, body: { job: job("asset_place") } },
    ]);
    const { result } = renderHook(() => useReviewActions(PROJECT_ID, "m1"), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <TestApiProvider api={api}>{children}</TestApiProvider>
      ),
    });
    await act(() => result.current.compute(false));
    expect(useJobsStore.getState().jobs["j-asset_place"]).toBeDefined();
    expect(result.current.running.place).toBe(true);
    expect(useToastStore.getState().toasts.at(-1)?.text).toMatch(/computing placements/i);
  });

  it("shows the server's reason when a job cannot start", async () => {
    const { api } = fakeClient([
      {
        method: "POST",
        path: /\/findings\/regroup$/,
        status: 409,
        body: {
          error: { code: "job_running", message: "A placement job is running for this model.", details: {} },
        },
      },
    ]);
    const { result } = renderHook(() => useReviewActions(PROJECT_ID, "m1"), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <TestApiProvider api={api}>{children}</TestApiProvider>
      ),
    });
    await act(() => result.current.regroup());
    expect(useToastStore.getState().toasts.at(-1)?.text).toMatch(/placement job is running/i);
  });
});
