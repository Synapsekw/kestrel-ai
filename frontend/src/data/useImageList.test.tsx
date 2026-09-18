import type { ReactNode } from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { exampleImage, exampleImage2, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { useImageList } from "./useImageList";

describe("useImageList", () => {
  beforeEach(() => useChangesStore.setState({ imagesRevision: 0, boxesRevision: {} }));

  it("loads the first page, appends the next cursor page and reloads on images.changed", async () => {
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/images$/,
        body: (req) =>
          req.url.includes("cursor=c1")
            ? { items: [exampleImage2], next_cursor: null, total: 2 }
            : { items: [exampleImage], next_cursor: "c1", total: 2 },
      },
    ]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>{children}</TestApiProvider>
    );
    const { result } = renderHook(() => useImageList(PROJECT_ID, { sort: "path", order: "asc" }, 1), {
      wrapper,
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.total).toBe(2);
    expect(result.current.hasMore).toBe(true);
    expect(requests[0].url).toContain("limit=1");

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.hasMore).toBe(false);
    expect(requests[1].url).toContain("cursor=c1");

    act(() => useChangesStore.getState().bumpImages());
    await waitFor(() => expect(requests).toHaveLength(3));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
  });

  it("exposes the error envelope message", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/images$/,
        status: 501,
        body: { error: { code: "not_implemented", message: "images later", details: {} } },
      },
    ]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>{children}</TestApiProvider>
    );
    const { result } = renderHook(() => useImageList(PROJECT_ID, { sort: "path", order: "asc" }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.error).toBe("images later"));
    expect(result.current.loading).toBe(false);
  });
});
