import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ApiClient } from "@contract/client";
import { exampleProject, fakeClient } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { fetchRecentProjects, useRecentProjects } from "./recentProjects";

describe("recent projects", () => {
  it("follows pages of GET /projects", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/api\/v1\/projects$/,
        body: (r) =>
          r.url.includes("cursor=c2")
            ? { items: [{ ...exampleProject, id: "p2", name: "Bridge A" }], next_cursor: null }
            : { items: [exampleProject], next_cursor: "c2" },
      },
    ]);
    expect((await fetchRecentProjects(api)).map((p) => p.name)).toEqual(["Ahmadia", "Bridge A"]);
  });

  it("loads them in a hook", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/api\/v1\/projects$/, body: { items: [exampleProject], next_cursor: null } },
    ]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api as ApiClient}>{children}</TestApiProvider>
    );
    const { result } = renderHook(() => useRecentProjects(), { wrapper });
    await waitFor(() => expect(result.current.projects).toHaveLength(1));
    expect(result.current.loading).toBe(false);
  });
});
