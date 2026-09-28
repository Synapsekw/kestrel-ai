import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createApiClient } from "@contract/client";
import { errorBody, fakeClient, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { measurementItem } from "@/test/measurementFixtures";
import { TestApiProvider } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { DEFAULT_FILTERS } from "./model";
import { MEASUREMENTS_PAGE, MEASUREMENTS_REFRESH_MAX, useMeasurementsList } from "./useMeasurementsList";

const LIST = /\/projects\/[^/]+\/measurements$/;
const many = (from: number, n: number) => Array.from({ length: n }, (_, i) => measurementItem(from + i));

function setup(routes: FakeRoute[]) {
  const { api, requests } = fakeClient(routes);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TestApiProvider api={api}>{children}</TestApiProvider>
  );
  return { requests, wrapper };
}
const params = (url: string) => new URL(url, "http://fake").searchParams;

describe("useMeasurementsList", () => {
  beforeEach(() => useChangesStore.setState({ measurementsRevision: 0, openProjectId: null }));

  it("loads the first page with the filter query", async () => {
    const { requests, wrapper } = setup([
      {
        method: "GET",
        path: LIST,
        body: { items: many(1, 3), next_cursor: null },
      },
    ]);
    const { result } = renderHook(() => useMeasurementsList(PROJECT_ID, { kind: "map", subKind: "area" }), {
      wrapper,
    });
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.items).toHaveLength(3);
    expect(result.current.hasMore).toBe(false);
    const p = params(requests[0].url);
    expect(p.get("limit")).toBe(String(MEASUREMENTS_PAGE));
    expect(p.get("kind")).toBe("map");
    expect(p.get("sub_kind")).toBe("area");
  });

  it("pages with the cursor, dedupes by kind and id, and stops on a repeated cursor", async () => {
    const { requests, wrapper } = setup([
      {
        method: "GET",
        path: LIST,
        body: (req) =>
          params(req.url).get("cursor")
            ? { items: [...many(2, 2), measurementItem(9)], next_cursor: "c1" }
            : { items: many(1, 2), next_cursor: "c1" },
      },
    ]);
    const { result } = renderHook(() => useMeasurementsList(PROJECT_ID, DEFAULT_FILTERS), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.hasMore).toBe(true);
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(4));
    expect(result.current.items.map((m) => m.id)).toEqual(["m-1", "m-2", "m-3", "m-9"]);
    expect(params(requests[1].url).get("cursor")).toBe("c1");
    // "c1" came back again: paging ends instead of looping (the Prism mock does this).
    expect(result.current.hasMore).toBe(false);
  });

  it("re-reads the shown rows, bounded, on a revision bump without a loading flash", async () => {
    let round = 0;
    const { requests, wrapper } = setup([
      {
        method: "GET",
        path: LIST,
        body: () => {
          round += 1;
          return {
            items: round === 1 ? many(1, 2) : many(1, 3),
            next_cursor: null,
          };
        },
      },
    ]);
    const { result } = renderHook(() => useMeasurementsList(PROJECT_ID, DEFAULT_FILTERS), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    act(() => useChangesStore.setState({ measurementsRevision: 1 }));
    expect(result.current.status).toBe("ready");
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    const limit = Number(params(requests.at(-1)!.url).get("limit"));
    expect(limit).toBeLessThanOrEqual(MEASUREMENTS_REFRESH_MAX);
    expect(limit).toBeGreaterThanOrEqual(MEASUREMENTS_PAGE);
  });

  it("reports an error and retries on reload", async () => {
    let fail = true;
    const { wrapper } = setup([
      {
        method: "GET",
        path: LIST,
        status: () => (fail ? 500 : 200),
        body: () =>
          fail ? errorBody("internal", "Database locked") : { items: many(1, 1), next_cursor: null },
      },
    ]);
    const { result } = renderHook(() => useMeasurementsList(PROJECT_ID, DEFAULT_FILTERS), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toMatch(/Database locked/);
    fail = false;
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.items).toHaveLength(1);
  });

  it("surfaces a failed next page as an error and keeps the rows shown", async () => {
    const { wrapper } = setup([
      {
        method: "GET",
        path: LIST,
        status: (req) => (params(req.url).get("cursor") ? 500 : 200),
        body: (req) =>
          params(req.url).get("cursor")
            ? errorBody("internal", "Database locked")
            : { items: many(1, 2), next_cursor: "c1" },
      },
    ]);
    const { result } = renderHook(() => useMeasurementsList(PROJECT_ID, DEFAULT_FILTERS), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toMatch(/Database locked/);
    expect(result.current.items).toHaveLength(2);
  });

  it("drops a refresh response that lands after a newer one", async () => {
    const pending: ((items: number) => void)[] = [];
    let calls = 0;
    const respond = (n: number) =>
      new Response(JSON.stringify({ items: many(1, n), next_cursor: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const fetchImpl = (() => {
      calls += 1;
      if (calls === 1) return Promise.resolve(respond(1));
      return new Promise<Response>((resolve) => pending.push((n) => resolve(respond(n))));
    }) as unknown as typeof fetch;
    const api = createApiClient({ baseUrl: "http://fake", token: "t", fetch: fetchImpl });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>{children}</TestApiProvider>
    );
    const { result } = renderHook(() => useMeasurementsList(PROJECT_ID, DEFAULT_FILTERS), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => useChangesStore.setState({ measurementsRevision: 1 }));
    await waitFor(() => expect(pending).toHaveLength(1));
    act(() => useChangesStore.setState({ measurementsRevision: 2 }));
    await waitFor(() => expect(pending).toHaveLength(2));
    // The newer refresh answers first, then the older one arrives late.
    await act(async () => pending[1](3));
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    await act(async () => {
      pending[0](2);
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current.items).toHaveLength(3);
  });
});
