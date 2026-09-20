import type { ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { fetchDatasets } from "@/api/datasets";
import { errorBody, exampleDataset, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useDatasetNames } from "./useDatasetNames";

function wrapperFor(api: ReturnType<typeof fakeClient>["api"]) {
  return ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
}

describe("useDatasetNames", () => {
  it("is not loaded until the datasets arrive, then maps id to name", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/datasets$/, body: { items: [exampleDataset], next_cursor: null } },
    ]);
    const { result } = renderHook(() => useDatasetNames(PROJECT_ID), { wrapper: wrapperFor(api) });
    expect(result.current.loaded).toBe(false);
    expect(result.current.names).toEqual({});
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.names).toEqual({ [exampleDataset.id]: exampleDataset.name });
  });

  it("stays not loaded when datasets are unavailable", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/datasets$/, status: 501, body: errorBody("not_implemented", "later") },
    ]);
    const { result } = renderHook(() => useDatasetNames(PROJECT_ID), { wrapper: wrapperFor(api) });
    // Flush the same rejected request the hook awaits internally (loaded must stay false either
    // way, so there is no state change here to wait on with `waitFor`).
    await act(async () => {
      await fetchDatasets(api, PROJECT_ID).catch(() => {});
    });
    expect(result.current.loaded).toBe(false);
    expect(result.current.names).toEqual({});
  });
});
