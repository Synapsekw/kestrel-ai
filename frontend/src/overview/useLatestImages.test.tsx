import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { errorBody, exampleImage, exampleImage2, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { useLatestImages } from "./useLatestImages";

vi.mock("@/app/diagnostics", async (orig) => ({ ...(await orig<object>()), pushLog: vi.fn() }));

const OTHER = "7f1c2e3a-2222-4000-8000-000000000002";

function setup(routes: Parameters<typeof fakeClient>[0]) {
  const stub = fakeClient(routes);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TestApiProvider api={stub.api}>{children}</TestApiProvider>
  );
  return { stub, wrapper };
}

const page = (items: unknown[]) => ({ items, next_cursor: null, total: items.length });

describe("useLatestImages", () => {
  it("returns the newest frames", async () => {
    const { wrapper } = setup([
      { method: "GET", path: /\/images$/, body: page([exampleImage, exampleImage2]) },
    ]);
    const { result } = renderHook(() => useLatestImages(PROJECT_ID, true), { wrapper });
    expect(result.current.images).toBeNull();
    await waitFor(() => expect(result.current.images).toHaveLength(2));
    expect(result.current.failed).toBe(false);
  });

  it("reports a failed read as an empty list", async () => {
    const { wrapper } = setup([
      { method: "GET", path: /\/images$/, status: 500, body: errorBody("internal", "boom") },
    ]);
    const { result } = renderHook(() => useLatestImages(PROJECT_ID, true), { wrapper });
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.images).toEqual([]);
  });

  it("makes no request while disabled", async () => {
    const { stub, wrapper } = setup([{ method: "GET", path: /\/images$/, body: page([exampleImage]) }]);
    const { result } = renderHook(() => useLatestImages(PROJECT_ID, false), { wrapper });
    await new Promise((r) => setTimeout(r, 50));
    expect(stub.requests).toHaveLength(0);
    expect(result.current.images).toBeNull();
  });

  it("never shows another project's frames after the project changes", async () => {
    const { wrapper } = setup([
      {
        method: "GET",
        path: /\/images$/,
        body: (req) => page(req.url.includes(OTHER) ? [exampleImage2] : [exampleImage]),
      },
    ]);
    const { result, rerender } = renderHook(({ id }) => useLatestImages(id, true), {
      wrapper,
      initialProps: { id: PROJECT_ID },
    });
    await waitFor(() => expect(result.current.images?.[0]?.id).toBe(exampleImage.id));
    rerender({ id: OTHER });
    expect(result.current.images).toBeNull();
    await waitFor(() => expect(result.current.images?.[0]?.id).toBe(exampleImage2.id));
  });

  it("re-reads once after a burst of data changes, not once per change", async () => {
    useChangesStore.setState({ dataRevision: 0 });
    const { stub, wrapper } = setup([{ method: "GET", path: /\/images$/, body: page([exampleImage]) }]);
    const { result } = renderHook(() => useLatestImages(PROJECT_ID, true), { wrapper });
    await waitFor(() => expect(result.current.images).toHaveLength(1));
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
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(stub.requests).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
