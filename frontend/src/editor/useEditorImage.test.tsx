import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useLayoutEffect, type ReactNode } from "react";
import { exampleImage, fakeClient, IMAGE_ID, PROJECT_ID } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useEditorStore } from "@/store/editor";
import { useEditorImage } from "./useEditorImage";

type Routes = Parameters<typeof fakeClient>[0];

const base: Routes = [
  { method: "GET", path: /\/images\/[^/]+$/, body: exampleImage },
  { method: "GET", path: /\/boxes$/, body: { items: [], next_cursor: null } },
];

describe("useEditorImage loading", () => {
  beforeEach(() => useEditorStore.getState().reset());

  it("never commits the loaded image while still reporting loading", async () => {
    const { api } = fakeClient(base);
    // Every committed render: is the image showing, and does the hook still say "loading"?
    const commits: { shown: boolean; loading: boolean }[] = [];
    renderHook(
      () => {
        const { loading } = useEditorImage(PROJECT_ID, IMAGE_ID);
        const shown = useEditorStore((s) => s.imageId === IMAGE_ID);
        useLayoutEffect(() => {
          commits.push({ shown, loading });
        });
        return loading;
      },
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <TestApiProvider api={api}>{children}</TestApiProvider>
        ),
      },
    );
    await waitFor(() => expect(commits.at(-1)).toEqual({ shown: true, loading: false }));
    // The hotkeys are gated on `loading`: a commit that shows the image with loading still true
    // is a window where a key press on the visible image is silently dropped.
    expect(commits.filter((c) => c.shown && c.loading)).toEqual([]);
  });
});
