import type { ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { errorBody, exampleJobLog, fakeClient, JOB_ID, PROJECT_ID } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useJobLog } from "./useJobLog";

describe("useJobLog", () => {
  it("loads the tail once when not live and reports errors", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /\/log$/, body: exampleJobLog }]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>{children}</TestApiProvider>
    );
    const { result } = renderHook(() => useJobLog(PROJECT_ID, JOB_ID, false, 50), { wrapper });
    await waitFor(() => expect(result.current.lines).toHaveLength(2));
    expect(requests[0].url).toBe(`/api/v1/projects/${PROJECT_ID}/jobs/${JOB_ID}/log?tail=50`);
    await new Promise((r) => setTimeout(r, 20));
    expect(requests).toHaveLength(1);

    const failing = fakeClient([
      { method: "GET", path: /\/log$/, status: 404, body: errorBody("not_found", "no log yet") },
    ]);
    const wrapper2 = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={failing.api}>{children}</TestApiProvider>
    );
    const bad = renderHook(() => useJobLog(PROJECT_ID, JOB_ID, false), { wrapper: wrapper2 });
    await waitFor(() => expect(bad.result.current.error).toBe("no log yet"));
    expect(bad.result.current.lines).toEqual([]);
  });

  it("returns nothing without a job id", () => {
    const { api } = fakeClient([]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>{children}</TestApiProvider>
    );
    const { result } = renderHook(() => useJobLog(PROJECT_ID, null, true), { wrapper });
    expect(result.current).toEqual({ lines: [], error: null });
  });
});
