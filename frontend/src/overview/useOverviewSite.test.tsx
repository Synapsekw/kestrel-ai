import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { exampleSite } from "@/test/findingFixtures";
import { TestApiProvider } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { useOverviewSite } from "./useOverviewSite";

vi.mock("@/app/diagnostics", async (orig) => ({ ...(await orig<object>()), pushLog: vi.fn() }));

describe("useOverviewSite", () => {
  it("reads at once, then re-reads once after a burst of data changes", async () => {
    useChangesStore.setState({ dataRevision: 0 });
    const stub = fakeClient([{ method: "GET", path: /\/overview\/site$/, body: exampleSite }]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={stub.api}>{children}</TestApiProvider>
    );
    const { result } = renderHook(() => useOverviewSite(PROJECT_ID, true), { wrapper });
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(stub.requests).toHaveLength(1);
    vi.useFakeTimers();
    try {
      act(() => {
        useChangesStore.getState().bumpData();
        useChangesStore.getState().bumpData();
        useChangesStore.getState().bumpData();
      });
      await act(() => vi.advanceTimersByTimeAsync(399));
      expect(stub.requests).toHaveLength(1);
      // The last site stays on screen while the re-read is pending.
      expect(result.current.site).toEqual(exampleSite);
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(stub.requests).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
