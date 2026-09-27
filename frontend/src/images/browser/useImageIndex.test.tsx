import { beforeEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useChangesStore } from "@/store/changes";
import { errorBody, fakeClient, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import type { ImageIndexQuery } from "./api";
import { DEFAULT_BROWSER_FILTERS, type BrowserFilterState } from "./filters";
import { indexNeighbours } from "./navigation";
import { idAt, makeIndexResponse } from "./testing";
import { useImageIndex } from "./useImageIndex";

const INDEX = /\/images\/index$/;
type IndexPath = "/api/v1/projects/{projectId}/images/index";
/** The init shape `fetchImageIndex` actually passes to `api.GET` for `IndexPath` (see api.ts). */
interface IndexGetInit {
  params: { path: { projectId: string }; query: ImageIndexQuery };
}

function setup(routes: FakeRoute[]) {
  const { api, requests } = fakeClient(routes);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TestApiProvider api={api}>{children}</TestApiProvider>
  );
  const indexCalls = () => requests.filter((r) => INDEX.test(r.url.split("?")[0]));
  return { wrapper, indexCalls };
}

const params = (url: string) => new URL(url, "http://fake").searchParams;

describe("useImageIndex", () => {
  beforeEach(() => useChangesStore.setState({ imagesRevision: 0, findingsRevision: 0 }));

  it("loads the parallel arrays with one request, geo included", async () => {
    const { wrapper, indexCalls } = setup([{ method: "GET", path: INDEX, body: makeIndexResponse(6) }]);
    const { result } = renderHook(() => useImageIndex(PROJECT_ID, DEFAULT_BROWSER_FILTERS), { wrapper });
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.total).toBe(6);
    expect(result.current.ids).toHaveLength(6);
    expect(result.current.lon).toHaveLength(6);
    expect(result.current.ordinalOf(idAt(4))).toBe(4);
    expect(result.current.ordinalOf("missing")).toBe(-1);
    expect(indexCalls()).toHaveLength(1);
    expect(params(indexCalls()[0].url).get("fields")).toBe("geo");
  });

  it("fills lon/lat with nulls when the answer has no geo arrays", async () => {
    const noGeo = { ...makeIndexResponse(2) };
    delete noGeo.lon;
    delete noGeo.lat;
    const { wrapper } = setup([{ method: "GET", path: INDEX, body: noGeo }]);
    const { result } = renderHook(() => useImageIndex(PROJECT_ID, DEFAULT_BROWSER_FILTERS), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.lon).toEqual([null, null]);
  });

  it("asks once per filter change, not per render", async () => {
    const { wrapper, indexCalls } = setup([{ method: "GET", path: INDEX, body: makeIndexResponse(3) }]);
    const { result, rerender } = renderHook(
      ({ f }: { f: BrowserFilterState }) => useImageIndex(PROJECT_ID, f),
      { wrapper, initialProps: { f: { ...DEFAULT_BROWSER_FILTERS } } },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ f: { ...DEFAULT_BROWSER_FILTERS } }); // equal values, new object
    rerender({ f: { ...DEFAULT_BROWSER_FILTERS, hasFindings: true } });
    await waitFor(() => expect(indexCalls()).toHaveLength(2));
    expect(params(indexCalls()[1].url).get("has_findings")).toBe("true");
  });

  it("the newest filter wins when answers arrive out of order", async () => {
    const gate: { open?: () => void } = {};
    const slow = new Promise<void>((r) => (gate.open = r));
    const { api } = fakeClient([
      {
        method: "GET",
        path: INDEX,
        body: (r) => (params(r.url).get("has_findings") ? makeIndexResponse(2) : makeIndexResponse(9)),
      },
    ]);
    // Delay only the unfiltered answer, so it lands after the filtered one. Typed against the
    // one endpoint this test drives (INDEX_PATH / IndexGetInit) rather than `Parameters<typeof
    // api.GET>`, whose generic, conditional-rest signature does not resolve to a spreadable tuple
    // once its type parameters are erased (tsc -b: TS2556 / TS2488).
    const delayed = {
      ...api,
      GET: (async (path: IndexPath, init: IndexGetInit) => {
        if (!init.params.query.has_findings) await slow;
        return api.GET(path, { ...init });
      }) as typeof api.GET,
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={delayed}>{children}</TestApiProvider>
    );
    const { result, rerender } = renderHook(
      ({ f }: { f: BrowserFilterState }) => useImageIndex(PROJECT_ID, f),
      { wrapper, initialProps: { f: DEFAULT_BROWSER_FILTERS } },
    );
    rerender({ f: { ...DEFAULT_BROWSER_FILTERS, hasFindings: true } });
    await waitFor(() => expect(result.current.total).toBe(2));
    await act(async () => {
      gate.open?.();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current.total).toBe(2);
  });

  it("re-reads once, debounced, for a burst of changes, keeping the arrays on screen", async () => {
    const { wrapper, indexCalls } = setup([{ method: "GET", path: INDEX, body: makeIndexResponse(3) }]);
    const { result } = renderHook(() => useImageIndex(PROJECT_ID, DEFAULT_BROWSER_FILTERS), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => {
      useChangesStore.getState().bumpFindings();
      useChangesStore.getState().bumpImages();
      useChangesStore.getState().bumpFindings();
    });
    expect(result.current.status).toBe("ready");
    expect(result.current.total).toBe(3);
    await waitFor(() => expect(indexCalls()).toHaveLength(2), { timeout: 2000 });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 900));
    });
    expect(indexCalls()).toHaveLength(2);
  });

  it("reports too_many_images with its code", async () => {
    const { wrapper } = setup([
      {
        method: "GET",
        path: INDEX,
        status: 422,
        body: errorBody("too_many_images", "More than 100000 images match", { total: 120000, cap: 100000 }),
      },
    ]);
    const { result } = renderHook(() => useImageIndex(PROJECT_ID, DEFAULT_BROWSER_FILTERS), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.errorCode).toBe("too_many_images");
    expect(result.current.total).toBe(0);
  });
});

describe("indexNeighbours", () => {
  const index = { ids: ["a", "b", "c"], ordinalOf: (id: string | null) => ["a", "b", "c"].indexOf(id ?? "") };
  it("gives prev and next around the current image", () => {
    expect(indexNeighbours(index, "b")).toEqual({ ordinal: 1, prev: "a", next: "c" });
    expect(indexNeighbours(index, "a")).toEqual({ ordinal: 0, prev: null, next: "b" });
    expect(indexNeighbours(index, "c")).toEqual({ ordinal: 2, prev: "b", next: null });
  });
  it("starts at the first image when the current one is not in the index", () => {
    expect(indexNeighbours(index, "zzz")).toEqual({ ordinal: -1, prev: null, next: "a" });
    expect(indexNeighbours({ ids: [], ordinalOf: () => -1 }, null)).toEqual({
      ordinal: -1,
      prev: null,
      next: null,
    });
  });
});
