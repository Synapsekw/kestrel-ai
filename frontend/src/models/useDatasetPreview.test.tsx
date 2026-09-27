import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createApiClient, type ApiClient } from "@contract/client";
import type { DatasetFilter } from "@/api/libraryDatasets";
import { examplePreview } from "@/test/appSectionFixtures";
import { TestApiProvider } from "@/test/render";
import { PREVIEW_DEBOUNCE_MS, useDatasetPreview } from "./useDatasetPreview";

const filter = (projects: string[]): DatasetFilter => ({
  project_ids: projects,
  type_ids: ["t1"],
  captured_from: null,
  captured_to: null,
  reviewed_only: true,
});

/** Counts 10 images per project; a one-project filter answers after a slow second. */
function slowFirstApi(calls: string[][]): ApiClient {
  const fetchImpl = (async (input: Request | string | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const body = JSON.parse(await req.text()) as DatasetFilter;
    calls.push(body.project_ids);
    if (body.project_ids.length === 1) await new Promise((r) => setTimeout(r, 1000));
    return new Response(JSON.stringify({ ...examplePreview, images: body.project_ids.length * 10 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return createApiClient({ baseUrl: "http://fake", token: "t", fetch: fetchImpl });
}

describe("useDatasetPreview", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("waits for the filter to settle before counting", async () => {
    const calls: string[][] = [];
    const api = slowFirstApi(calls);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>{children}</TestApiProvider>
    );
    const { rerender } = renderHook(({ f }) => useDatasetPreview(f), {
      wrapper,
      initialProps: { f: filter(["a", "b"]) },
    });
    rerender({ f: filter(["a", "b", "c"]) });
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_DEBOUNCE_MS));
    expect(calls).toEqual([["a", "b", "c"]]);
  });

  it("never shows the counts of a filter that is no longer current", async () => {
    const calls: string[][] = [];
    const api = slowFirstApi(calls);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>{children}</TestApiProvider>
    );
    const { result, rerender } = renderHook(({ f }) => useDatasetPreview(f), {
      wrapper,
      initialProps: { f: filter(["a"]) },
    });
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_DEBOUNCE_MS));
    rerender({ f: filter(["a", "b"]) });
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_DEBOUNCE_MS));
    await vi.waitFor(() => expect(result.current.preview?.images).toBe(20));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(result.current.preview?.images).toBe(20);
    expect(calls).toEqual([["a"], ["a", "b"]]);
  });

  it("does nothing without a filter", () => {
    const calls: string[][] = [];
    const api = slowFirstApi(calls);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>{children}</TestApiProvider>
    );
    const { result } = renderHook(() => useDatasetPreview(null), { wrapper });
    expect(result.current).toEqual({ preview: null, loading: false, error: null });
  });
});
