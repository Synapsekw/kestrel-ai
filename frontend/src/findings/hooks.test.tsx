import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { errorBody, fakeClient, PROJECT_ID, SOURCE_ID, type FakeRoute } from "@/test/fixtures";
import { baseRoutes, exampleFinding, TYPE_CRACK, TYPE_SPALLING } from "@/test/findingFixtures";
import { TestApiProvider } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import type { Finding } from "@/api/findings";
import { DEFAULT_FILTERS } from "./filters";
import { FINDINGS_PAGE, FINDINGS_REFRESH_MAX, useFindingsList } from "./useFindingsList";
import { useDataLabels } from "./useDataLabels";
import { useProjectTypes } from "./useProjectTypes";

const many = (from: number, n: number): Finding[] =>
  Array.from({ length: n }, (_, i) => ({ ...exampleFinding, id: `f-${from + i}`, number: from + i }));

function setup(routes: FakeRoute[]) {
  const { api, requests } = fakeClient(routes);
  const wrapper = ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
  return { requests, wrapper };
}

const params = (url: string) => new URL(url, "http://fake").searchParams;

describe("useFindingsList", () => {
  beforeEach(() => useChangesStore.setState({ findingsRevision: 0, dataRevision: 0 }));

  it("loads the first page with the filter query", async () => {
    const { requests, wrapper } = setup([
      { method: "GET", path: /\/findings$/, body: { items: many(1, 3), next_cursor: null } },
    ]);
    const { result } = renderHook(() => useFindingsList(PROJECT_ID, { ...DEFAULT_FILTERS, status: "open" }), { wrapper });
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.items).toHaveLength(3);
    expect(result.current.hasMore).toBe(false);
    const p = params(requests[0].url);
    expect(p.get("limit")).toBe(String(FINDINGS_PAGE));
    expect(p.getAll("status")).toEqual(["open"]);
  });

  it("pages with the cursor, dedupes, and stops on a repeated cursor", async () => {
    const { requests, wrapper } = setup([
      {
        method: "GET",
        path: /\/findings$/,
        body: (r) =>
          params(r.url).get("cursor") === "c1"
            ? { items: [...many(2, 1), ...many(3, 2)], next_cursor: "c1" }
            : { items: many(1, 2), next_cursor: "c1" },
      },
    ]);
    const { result } = renderHook(() => useFindingsList(PROJECT_ID, DEFAULT_FILTERS), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(4));
    expect(result.current.items.map((f) => f.number)).toEqual([1, 2, 3, 4]);
    expect(params(requests[1].url).get("cursor")).toBe("c1");
    expect(result.current.hasMore).toBe(false);
  });

  it("starts over when the filters change", async () => {
    const { requests, wrapper } = setup([
      { method: "GET", path: /\/findings$/, body: { items: many(1, 1), next_cursor: null } },
    ]);
    const { result, rerender } = renderHook(({ status }) => useFindingsList(PROJECT_ID, { ...DEFAULT_FILTERS, status }), {
      wrapper,
      initialProps: { status: "open" as "open" | "closed" },
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ status: "closed" });
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(params(requests[1].url).getAll("status")).toEqual(["closed"]);
  });

  it("refreshes at most 500 rows and keeps paging", async () => {
    let pages = 0;
    const { requests, wrapper } = setup([
      {
        method: "GET",
        path: /\/findings$/,
        body: (r) => {
          const p = params(r.url);
          const limit = Number(p.get("limit"));
          if (limit === FINDINGS_REFRESH_MAX) return { items: many(1, 500), next_cursor: "after-500" };
          pages += 1;
          return pages === 1 ? { items: many(1, 200), next_cursor: "a" } : { items: many(200 * (pages - 1) + 1, 200), next_cursor: `p${pages}` };
        },
      },
    ]);
    const { result } = renderHook(() => useFindingsList(PROJECT_ID, DEFAULT_FILTERS), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(200));
    for (const n of [400, 600]) {
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.items).toHaveLength(n));
    }
    act(() => useChangesStore.getState().bumpFindings());
    await waitFor(() => expect(result.current.items).toHaveLength(500), { timeout: 2000 });
    expect(new Set(result.current.items.map((f) => f.id)).size).toBe(500);
    const refresh = requests.at(-1)!;
    expect(params(refresh.url).get("limit")).toBe("500");
    expect(params(refresh.url).get("cursor")).toBeNull();
    act(() => result.current.loadMore());
    await waitFor(() => expect(params(requests.at(-1)!.url).get("cursor")).toBe("after-500"));
  });

  it("reports a failed first page", async () => {
    const { wrapper } = setup([
      { method: "GET", path: /\/findings$/, status: 500, body: errorBody("internal", "database is locked") },
    ]);
    const { result } = renderHook(() => useFindingsList(PROJECT_ID, DEFAULT_FILTERS), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("database is locked");
  });
});

describe("lookups", () => {
  it("maps data item ids to labels", async () => {
    const { wrapper, requests } = setup(baseRoutes());
    const { result } = renderHook(() => useDataLabels(PROJECT_ID), { wrapper });
    await waitFor(() => expect(result.current.get(SOURCE_ID)).toBe("Flight 14 Sep"));
    expect(params(requests.find((r) => r.url.includes("/data"))!.url).get("limit")).toBe("200");
  });

  it("splits the project's types into a lookup and the defect list", async () => {
    const { wrapper } = setup(baseRoutes());
    const { result } = renderHook(() => useProjectTypes(PROJECT_ID), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.types.get(TYPE_CRACK)?.name).toBe("Crack");
    expect(result.current.defectTypes.map((t) => t.id)).toEqual([TYPE_SPALLING, TYPE_CRACK]);
  });
});
