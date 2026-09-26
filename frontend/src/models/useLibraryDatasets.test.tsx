import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ApiClient } from "@contract/client";
import { errorBody, fakeClient } from "@/test/fixtures";
import { exampleLibraryDataset } from "@/test/appSectionFixtures";
import { TestApiProvider } from "@/test/render";
import { useLibraryDatasets } from "./useLibraryDatasets";

const wrapper =
  (api: ApiClient) =>
  ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;

describe("useLibraryDatasets", () => {
  it("loads the first page, loads more once and removes locally", async () => {
    const second = { ...exampleLibraryDataset, id: "d2", name: "machines-v2" };
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/library\/datasets$/,
        body: (r) =>
          r.url.includes("cursor=c2")
            ? { items: [second], next_cursor: null }
            : { items: [exampleLibraryDataset], next_cursor: "c2" },
      },
    ]);
    const { result } = renderHook(() => useLibraryDatasets(), { wrapper: wrapper(api) });
    await waitFor(() => expect(result.current.datasets).toHaveLength(1));
    expect(result.current.hasMore).toBe(true);
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.datasets).toHaveLength(2));
    expect(result.current.hasMore).toBe(false);
    act(() => result.current.remove("d2"));
    expect(result.current.datasets.map((d) => d.id)).toEqual([exampleLibraryDataset.id]);
  });

  it("reports an unopened library as unavailable", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/library\/datasets$/,
        status: 503,
        body: errorBody("library_unavailable", "no library"),
      },
    ]);
    const { result } = renderHook(() => useLibraryDatasets(), { wrapper: wrapper(api) });
    await waitFor(() => expect(result.current.unavailable).toBe(true));
    expect(result.current.error).toBeNull();
  });
});
