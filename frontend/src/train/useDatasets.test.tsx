import type { ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { exampleDataset, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useDatasets } from "./useDatasets";

function wrapperFor(api: ReturnType<typeof fakeClient>["api"]) {
  return ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
}

describe("useDatasets", () => {
  it("loads the list and removes a dataset locally, ahead of a reload (I6/M5b)", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/datasets$/, body: { items: [exampleDataset], next_cursor: null } },
    ]);
    const { result } = renderHook(() => useDatasets(PROJECT_ID), { wrapper: wrapperFor(api) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.datasets.map((d) => d.id)).toEqual([exampleDataset.id]);
    act(() => result.current.remove(exampleDataset.id));
    expect(result.current.datasets).toEqual([]);
  });
});
