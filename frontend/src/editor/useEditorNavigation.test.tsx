import type { ReactNode } from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { exampleImagePage, fakeClient, PROJECT_ID, IMAGE_ID, IMAGE_ID_2 } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useEditorStore } from "@/store/editor";
import { useNavigationStore } from "@/store/navigation";
import { useEditorNavigation } from "./useEditorNavigation";

function useHarness(projectId: string, imageId: string) {
  return { nav: useEditorNavigation(projectId, imageId), path: useLocation().pathname };
}

describe("useEditorNavigation", () => {
  beforeEach(() => {
    useNavigationStore.getState().setContext([], null);
    useEditorStore.getState().reset();
  });

  it("loads a context on a deep link and navigates after pending requests settle", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /\/images$/, body: exampleImagePage }]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>
        <MemoryRouter initialEntries={[`/p/${PROJECT_ID}/images/${IMAGE_ID}`]}>
          <Routes>
            <Route path="/p/:projectId/images/:imageId" element={children} />
          </Routes>
        </MemoryRouter>
      </TestApiProvider>
    );
    const { result } = renderHook(() => useHarness(PROJECT_ID, IMAGE_ID), { wrapper });
    await waitFor(() => expect(result.current.nav.position).toEqual({ index: 0, count: 2 }));
    expect(requests[0].url).toContain("sort=path");
    expect(requests[0].url).toContain("limit=1000");

    useEditorStore.getState().beginRequest();
    act(() => result.current.nav.next());
    // `go` awaits `waitForIdle` before navigating; the store is still pending, so the promise
    // chain cannot have resolved yet, deterministically (no wall-clock wait needed).
    await act(() => Promise.resolve());
    expect(result.current.path).toBe(`/p/${PROJECT_ID}/images/${IMAGE_ID}`);
    act(() => useEditorStore.getState().endRequest());
    await waitFor(() => expect(result.current.path).toBe(`/p/${PROJECT_ID}/images/${IMAGE_ID_2}`));
  });

  it("uses an existing context without fetching", async () => {
    useNavigationStore.getState().setContext(["x", IMAGE_ID, "y"], "selection");
    const { api, requests } = fakeClient([]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>
        <MemoryRouter initialEntries={[`/p/${PROJECT_ID}/images/${IMAGE_ID}`]}>{children}</MemoryRouter>
      </TestApiProvider>
    );
    const { result } = renderHook(() => useEditorNavigation(PROJECT_ID, IMAGE_ID), { wrapper });
    expect(result.current.position).toEqual({ index: 1, count: 3 });
    // `known` is true from the start, so the effect returns before it would fetch; nothing async
    // to wait on (deterministic, no wall-clock wait needed).
    expect(requests).toHaveLength(0);
  });
});
