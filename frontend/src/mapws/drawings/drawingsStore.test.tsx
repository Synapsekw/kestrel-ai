import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { useDrawing, useDrawingList, useDrawingsStore } from "./drawingsStore";
import { DRAWING_ID, pdfDrawing, placedPdfDrawing } from "./testFixtures";

describe("drawingsStore", () => {
  beforeEach(() => {
    useDrawingsStore.setState({ key: null, projectId: null, byId: {}, order: [] });
    useChangesStore.setState({ mapWorkspaceRevision: 0 });
  });

  it("loads the list once for many rows, and again on mapWorkspaceRevision", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/drawings$/, body: { items: [pdfDrawing] } },
    ]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>{children}</TestApiProvider>
    );
    const a = renderHook(() => useDrawing(PROJECT_ID, DRAWING_ID), { wrapper });
    const list = renderHook(() => useDrawingList(PROJECT_ID), { wrapper });
    await waitFor(() => expect(a.result.current?.id).toBe(DRAWING_ID));
    expect(list.result.current?.map((d) => d.id)).toEqual([DRAWING_ID]);
    expect(requests.filter((r) => r.method === "GET")).toHaveLength(1);
    act(() => useChangesStore.setState({ mapWorkspaceRevision: 1 }));
    await waitFor(() => expect(requests.filter((r) => r.method === "GET")).toHaveLength(2));
  });

  it("is null until the project's list has loaded", () => {
    const { api } = fakeClient([]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>{children}</TestApiProvider>
    );
    useDrawingsStore.getState().set("other:0", "other", [pdfDrawing]);
    const { result } = renderHook(() => useDrawing(PROJECT_ID, DRAWING_ID), { wrapper });
    expect(result.current).toBeNull();
  });

  it("upsert replaces one drawing without a reload; remove drops it", () => {
    useDrawingsStore.getState().set(`${PROJECT_ID}:0`, PROJECT_ID, [pdfDrawing]);
    useDrawingsStore.getState().upsert(placedPdfDrawing);
    expect(useDrawingsStore.getState().byId[DRAWING_ID].georef_version).toBe(2);
    expect(useDrawingsStore.getState().order).toEqual([DRAWING_ID]);
    useDrawingsStore.getState().remove(DRAWING_ID);
    expect(useDrawingsStore.getState().byId[DRAWING_ID]).toBeUndefined();
    expect(useDrawingsStore.getState().order).toEqual([]);
  });
});
