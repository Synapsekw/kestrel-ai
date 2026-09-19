import type { ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
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
    // Give the failed fetch a tick to settle; loaded must remain false either way.
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.loaded).toBe(false);
    expect(result.current.names).toEqual({});
  });
});
