import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ApiClient, AppEvent } from "@contract/client";
import { errorBody, fakeClient } from "@/test/fixtures";
import { exampleCataloguePage, exampleTypes } from "@/test/appSectionFixtures";
import { TestApiProvider } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { useCatalogue } from "./useCatalogue";

const wrapper =
  (api: ApiClient) =>
  ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;

describe("useCatalogue", () => {
  it("loads every type and the classification flag", async () => {
    const { api } = fakeClient([{ method: "GET", path: /\/catalogue\/types$/, body: exampleCataloguePage }]);
    const { result } = renderHook(() => useCatalogue(), { wrapper: wrapper(api) });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.types).toHaveLength(4);
    expect(result.current.needsClassification).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("reports the 503 as unavailable with its folder, not as an error", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/catalogue\/types$/,
        status: 503,
        body: errorBody("catalogue_unavailable", "locked", { folder: "C:\\lib" }),
      },
    ]);
    const { result } = renderHook(() => useCatalogue(), { wrapper: wrapper(api) });
    await waitFor(() => expect(result.current.unavailable).toBe(true));
    expect(result.current.folder).toBe("C:\\lib");
    expect(result.current.error).toBeNull();
  });

  it("reloads when the catalogue changes", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/catalogue\/types$/, body: exampleCataloguePage },
    ]);
    const { result } = renderHook(() => useCatalogue(), { wrapper: wrapper(api) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      useChangesStore
        .getState()
        .applyEvent({ type: "catalogue.changed", payload: {} } as unknown as AppEvent);
    });
    await waitFor(() => expect(requests.filter((r) => r.method === "GET")).toHaveLength(2));
  });

  it("put() shows a saved type at once", async () => {
    const { api } = fakeClient([{ method: "GET", path: /\/catalogue\/types$/, body: exampleCataloguePage }]);
    const { result } = renderHook(() => useCatalogue(), { wrapper: wrapper(api) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.put({ ...exampleTypes[0], kind: "defect" }));
    expect(result.current.types[0].kind).toBe("defect");
    act(() => result.current.put({ ...exampleTypes[0], id: "new", name: "Rust" }));
    expect(result.current.types.map((t) => t.name)).toContain("Rust");
  });
});
