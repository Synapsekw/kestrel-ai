import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { runningJob } from "@/test/fixtures";
import { useJobsStore } from "@/store/jobs";
import { useOnJobsFinished } from "./useOnJobsFinished";

describe("useOnJobsFinished", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("fires once when a job of the watched type leaves the active states", () => {
    const onFinished = vi.fn();
    renderHook(() => useOnJobsFinished("infer", onFinished));
    act(() => useJobsStore.getState().upsert({ ...runningJob, type: "infer" }));
    expect(onFinished).not.toHaveBeenCalled();
    act(() => useJobsStore.getState().upsert({ ...runningJob, type: "infer", progress: 0.9 }));
    expect(onFinished).not.toHaveBeenCalled();
    act(() => useJobsStore.getState().upsert({ ...runningJob, type: "infer", state: "succeeded" }));
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("ignores other job types and jobs that were already finished when first seen", () => {
    const onFinished = vi.fn();
    renderHook(() => useOnJobsFinished("infer", onFinished));
    act(() => useJobsStore.getState().upsert({ ...runningJob, type: "train" }));
    act(() => useJobsStore.getState().upsert({ ...runningJob, type: "train", state: "failed" }));
    act(() =>
      useJobsStore.getState().upsert({ ...runningJob, id: "old", type: "infer", state: "succeeded" }),
    );
    expect(onFinished).not.toHaveBeenCalled();
  });
});
