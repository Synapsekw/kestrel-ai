import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useChangesStore } from "@/store/changes";
import { exampleOverview, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { countsFromOverview, useProjectCounts } from "./useProjectCounts";

function wrapperFor(api: ReturnType<typeof fakeClient>["api"]) {
  return ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
}

describe("useProjectCounts", () => {
  beforeEach(() => useChangesStore.setState({ dataRevision: 0, findingsRevision: 0 }));

  it("reads images, maps, point clouds and open findings from the overview", () => {
    expect(countsFromOverview(exampleOverview)).toEqual({
      images: 1284,
      maps: 3,
      drawings: 0,
      pointClouds: 2,
      openFindings: 47,
    });
  });

  it("loads once, and again when data or findings change", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /\/overview$/, body: exampleOverview }]);
    const { result } = renderHook(() => useProjectCounts(PROJECT_ID), { wrapper: wrapperFor(api) });
    await waitFor(() => expect(result.current?.images).toBe(1284));
    expect(requests).toHaveLength(1);
    act(() => useChangesStore.setState({ findingsRevision: 1 }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(result.current?.openFindings).toBe(47);
  });

  it("gives no counts when the overview fails, without throwing", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/overview$/, status: 503, body: { error: { code: "x", message: "down" } } },
    ]);
    const { result } = renderHook(() => useProjectCounts(PROJECT_ID), { wrapper: wrapperFor(api) });
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(result.current).toBeNull();
  });
});
