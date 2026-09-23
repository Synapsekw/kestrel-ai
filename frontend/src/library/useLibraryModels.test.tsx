import type { ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { errorBody, exampleModel, exampleTrainedModel, fakeClient } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useLibraryModels } from "./useLibraryModels";

function wrapperFor(api: ReturnType<typeof fakeClient>["api"]) {
  return ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
}

describe("useLibraryModels", () => {
  it("loads the library, filters by task and supports replace, remove and reload", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/library\/models$/, body: { items: [exampleModel], next_cursor: null } },
    ]);
    const { result } = renderHook(() => useLibraryModels("detect"), { wrapper: wrapperFor(api) });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(requests[0].url).toBe("/api/v1/library/models?task=detect&limit=1000");
    expect(result.current.models.map((m) => m.id)).toEqual([exampleModel.id]);
    act(() => result.current.replace(exampleTrainedModel));
    expect(result.current.models.map((m) => m.id)).toEqual([exampleTrainedModel.id, exampleModel.id]);
    act(() => result.current.remove(exampleModel.id));
    expect(result.current.models.map((m) => m.id)).toEqual([exampleTrainedModel.id]);
    act(() => result.current.reload());
    await waitFor(() => expect(requests).toHaveLength(2));
    await waitFor(() => expect(result.current.models.map((m) => m.id)).toEqual([exampleModel.id]));
  });

  it("marks the library unavailable on 503 and reports other errors", async () => {
    const down = fakeClient([
      {
        method: "GET",
        path: /\/library\/models$/,
        status: 503,
        body: errorBody("library_unavailable", "library.db is corrupt"),
      },
    ]);
    const { result } = renderHook(() => useLibraryModels(), { wrapper: wrapperFor(down.api) });
    await waitFor(() => expect(result.current.unavailable).toBe(true));
    expect(result.current.error).toBeNull();
    const broken = fakeClient([
      { method: "GET", path: /\/library\/models$/, status: 500, body: errorBody("internal_error", "disk full") },
    ]);
    const bad = renderHook(() => useLibraryModels(), { wrapper: wrapperFor(broken.api) });
    await waitFor(() => expect(bad.result.current.error).toBe("disk full"));
    expect(bad.result.current.unavailable).toBe(false);
  });
});
