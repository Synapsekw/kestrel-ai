import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { exampleJob, fakeClient } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { useAssistModel } from "./useAssistModel";

const JOB = { ...exampleJob, type: "assist_acquire" as const, state: "running" as const };
const list = {
  method: "GET",
  path: /\/library\/assist-models$/,
  body: {
    items: [
      {
        key: "sam2.1_t",
        name: "SAM 2.1 tiny",
        description: "",
        size_mb: 78,
        sha256: "0".repeat(64),
        state: "missing",
        reason: null,
        job_id: JOB.id,
      },
    ],
    next_cursor: null,
  },
};

beforeEach(() => useJobsStore.setState({ jobs: {} }));

describe("useAssistModel", () => {
  it("reads the catalogue again once when its acquire job ends, not on later upserts (T9)", async () => {
    useJobsStore.getState().upsert(JOB);
    const { api, requests } = fakeClient([list]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>{children}</TestApiProvider>
    );
    const { result } = renderHook(() => useAssistModel(), { wrapper });
    await waitFor(() => expect(result.current.job?.id).toBe(JOB.id));
    const lists = () => requests.filter((r) => r.url.endsWith("/assist-models")).length;
    expect(lists()).toBe(1);

    act(() => useJobsStore.getState().upsert({ ...JOB, progress: 0.5 })); // still running
    act(() => useJobsStore.getState().upsert({ ...JOB, state: "succeeded", progress: 1 }));
    await waitFor(() => expect(lists()).toBe(2));

    // The ended job upserted again (a jobs-list refresh, a late event): no further reads.
    act(() => useJobsStore.getState().upsert({ ...JOB, state: "succeeded", progress: 1, message: "done" }));
    act(() => useJobsStore.getState().upsert({ ...JOB, state: "succeeded", progress: 1, message: "done." }));
    await act(async () => {});
    expect(lists()).toBe(2);
  });
});
