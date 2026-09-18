import type { ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { errorBody, exampleImagePage, fakeClient, IMAGE_ID, IMAGE_ID_2, PROJECT_ID } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { DEFAULT_QUERY_FORM } from "./queryModel";
import { useImageSelection } from "./useImageSelection";

function wrapperFor(api: ReturnType<typeof fakeClient>["api"]) {
  return ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
}

describe("useImageSelection", () => {
  it("returns the preloaded selection without a request", async () => {
    const { api, requests } = fakeClient([]);
    const { result } = renderHook(
      () => useImageSelection(PROJECT_ID, { ...DEFAULT_QUERY_FORM, mode: "selection" }, ["x", "y"]),
      { wrapper: wrapperFor(api) },
    );
    expect(result.current).toEqual({ ids: ["x", "y"], loading: false, error: null });
    await new Promise((r) => setTimeout(r, 10));
    expect(requests).toHaveLength(0);
  });

  it("lists unlabeled images and caps first_n", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /\/images$/, body: exampleImagePage }]);
    const { result } = renderHook(() => useImageSelection(PROJECT_ID, DEFAULT_QUERY_FORM, []), {
      wrapper: wrapperFor(api),
    });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.ids).toEqual([IMAGE_ID, IMAGE_ID_2]));
    const url = new URL(`http://x${requests[0].url}`);
    expect(url.searchParams.get("labeled")).toBe("false");
    expect(url.searchParams.get("limit")).toBe("1000");
    const one = renderHook(
      () => useImageSelection(PROJECT_ID, { ...DEFAULT_QUERY_FORM, mode: "first_n", firstN: "1" }, []),
      { wrapper: wrapperFor(api) },
    );
    await waitFor(() => expect(one.result.current.ids).toEqual([IMAGE_ID]));
  });

  it("reports listing errors", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/images$/, status: 500, body: errorBody("internal_error", "db locked") },
    ]);
    const { result } = renderHook(() => useImageSelection(PROJECT_ID, DEFAULT_QUERY_FORM, []), {
      wrapper: wrapperFor(api),
    });
    await waitFor(() => expect(result.current.error).toBe("db locked"));
    expect(result.current.ids).toEqual([]);
  });
});
