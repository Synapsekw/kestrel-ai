import { beforeEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useChangesStore } from "@/store/changes";
import { fakeClient, PROJECT_ID, type RecordedRequest } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { DETAIL_LRU_MAX, DetailCache, missingBatches } from "./detailCache";
import { idAt, imageRow } from "./testing";
import { resetDetailsForTests, useImageDetails } from "./useImageDetails";

const LIST = /\/images$/;
const idsOf = (r: RecordedRequest) =>
  (new URL(r.url, "http://fake").searchParams.get("ids") ?? "").split(",");

function setup() {
  const { api, requests } = fakeClient([
    {
      method: "GET",
      path: LIST,
      body: (r) => ({ items: idsOf(r).map((id) => imageRow(id, Number(id.slice(4)))), next_cursor: null }),
    },
  ]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TestApiProvider api={api}>{children}</TestApiProvider>
  );
  const calls = () => requests.filter((r) => LIST.test(r.url.split("?")[0]));
  return { wrapper, calls };
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => idAt(from + i));

describe("DetailCache", () => {
  it("evicts the least recently used row beyond its size", () => {
    const c = new DetailCache(3);
    for (const i of [0, 1, 2]) c.set(imageRow(idAt(i), i));
    c.get(idAt(0)); // 0 is now the newest
    c.set(imageRow(idAt(3), 3));
    expect(c.peek(idAt(1))).toBeUndefined();
    expect(c.peek(idAt(0))).toBeDefined();
    expect(c.size).toBe(3);
  });

  it("defaults to 2,000 rows", () => {
    const c = new DetailCache();
    for (let i = 0; i < DETAIL_LRU_MAX + 5; i++) c.set(imageRow(idAt(i), i));
    expect(c.size).toBe(DETAIL_LRU_MAX);
    expect(c.peek(idAt(4))).toBeUndefined();
    expect(c.peek(idAt(5))).toBeDefined();
  });
});

describe("missingBatches", () => {
  it("skips cached and in-flight ids and cuts batches of 200", () => {
    const ids = range(0, 450);
    const b = missingBatches(ids, (id) => id === idAt(0), new Set([idAt(1)]));
    expect(b.map((x) => x.length)).toEqual([200, 200, 48]);
    expect(b[0][0]).toBe(idAt(2));
  });
});

describe("useImageDetails", () => {
  beforeEach(() => {
    resetDetailsForTests();
    useChangesStore.setState({ imagesRevision: 0 });
  });

  it("fetches a window in batches of at most 200 ids and returns the rows", async () => {
    const { wrapper, calls } = setup();
    const { result } = renderHook(() => useImageDetails(PROJECT_ID, range(0, 450)), { wrapper });
    await waitFor(() => expect(result.current.size).toBe(450));
    expect(calls().map((r) => idsOf(r).length)).toEqual([200, 200, 50]);
    expect(result.current.get(idAt(7))?.file_name).toBe("DJI_0007.JPG");
  });

  it("never re-requests rows it holds or is fetching, across hooks", async () => {
    const { wrapper, calls } = setup();
    const a = renderHook(() => useImageDetails(PROJECT_ID, range(0, 30)), { wrapper });
    const b = renderHook(() => useImageDetails(PROJECT_ID, range(10, 40)), { wrapper });
    await waitFor(() => expect(b.result.current.size).toBe(30));
    await waitFor(() => expect(a.result.current.size).toBe(30));
    const asked = calls().flatMap(idsOf);
    expect(new Set(asked).size).toBe(asked.length); // no id asked twice
    expect(asked).toHaveLength(40);
  });

  it("scrolling back asks for nothing", async () => {
    const { wrapper, calls } = setup();
    const { rerender, result } = renderHook(
      ({ ids }: { ids: string[] }) => useImageDetails(PROJECT_ID, ids),
      {
        wrapper,
        initialProps: { ids: range(0, 30) },
      },
    );
    await waitFor(() => expect(result.current.size).toBe(30));
    rerender({ ids: range(30, 60) });
    await waitFor(() => expect(result.current.size).toBe(30));
    rerender({ ids: range(0, 30) });
    expect(result.current.size).toBe(30);
    expect(calls()).toHaveLength(2);
  });

  it("forgets rows when the image list changes", async () => {
    const { wrapper, calls } = setup();
    const { result } = renderHook(() => useImageDetails(PROJECT_ID, range(0, 5)), { wrapper });
    await waitFor(() => expect(result.current.size).toBe(5));
    act(() => useChangesStore.getState().bumpImages());
    await waitFor(() => expect(calls()).toHaveLength(2));
  });
});
