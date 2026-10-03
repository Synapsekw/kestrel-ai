import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetItemPage, ItemQuery } from "@/api/plantItems";
import { TestApiProvider } from "@/test/render";
import { fakeClient } from "@/test/fixtures";
import { itemRow } from "@/test/plantFixtures";

interface Call {
  query: ItemQuery;
  cursor: string | null | undefined;
  signal?: AbortSignal;
  resolve(p: AssetItemPage): void;
  reject(e: unknown): void;
}
const calls: Call[] = [];
vi.mock("@/api/plantItems", async (orig) => ({
  ...(await orig<typeof import("@/api/plantItems")>()),
  listAssetItems: vi.fn(
    (
      _api: unknown,
      _p: string,
      _m: string,
      _v: number,
      query: ItemQuery,
      cursor: string | null | undefined,
      signal?: AbortSignal,
    ) =>
      new Promise<AssetItemPage>((resolve, reject) => calls.push({ query, cursor, signal, resolve, reject })),
  ),
}));
import { useRegister } from "./useRegister";

const page = (nodes: string[], next: string | null) =>
  ({ items: nodes.map((node) => itemRow({ node, tag: node })), next_cursor: next }) as AssetItemPage;
function setup(initial: ItemQuery = {}) {
  const { api } = fakeClient([]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TestApiProvider api={api}>{children}</TestApiProvider>
  );
  return renderHook(({ q }: { q: ItemQuery }) => useRegister("p", "m1", 3, q), {
    wrapper,
    initialProps: { q: initial },
  });
}

describe("useRegister", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("loads the first page for the query", async () => {
    const h = setup({ q: "20-T" });
    expect(h.result.current.loading).toBe(true);
    expect(calls[0].query.q).toBe("20-T");
    expect(calls[0].cursor).toBeNull();
    await act(async () => calls[0].resolve(page(["a", "b"], null)));
    expect(h.result.current.rows.map((r) => r.node)).toEqual(["a", "b"]);
    expect(h.result.current.done).toBe(true);
    expect(h.result.current.loading).toBe(false);
  });

  it("drops a superseded query: only the last query rows show", async () => {
    const h = setup({ q: "20" });
    h.rerender({ q: { q: "30" } });
    expect(calls).toHaveLength(2);
    expect(calls[0].signal?.aborted).toBe(true);
    expect(calls[1].signal?.aborted).toBe(false);
    await act(async () => calls[1].resolve(page(["thirty"], null)));
    await act(async () => calls[0].resolve(page(["twenty"], null)));
    expect(h.result.current.rows.map((r) => r.node)).toEqual(["thirty"]);
  });

  it("loads the next page once, however often the end is reached", async () => {
    const h = setup();
    await act(async () => calls[0].resolve(page(["a"], "c2")));
    act(() => {
      h.result.current.loadMore();
      h.result.current.loadMore();
    });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].cursor).toBe("c2");
    await act(async () => calls[1].resolve(page(["b"], null)));
    expect(h.result.current.rows.map((r) => r.node)).toEqual(["a", "b"]);
    act(() => h.result.current.loadMore());
    expect(calls).toHaveLength(2);
  });

  it("an error keeps the rows and retry asks again", async () => {
    const h = setup();
    await act(async () => calls[0].resolve(page(["a"], "c2")));
    act(() => h.result.current.loadMore());
    await waitFor(() => expect(calls).toHaveLength(2));
    await act(async () => calls[1].reject(new Error("The server did not answer.")));
    expect(h.result.current.error).toBe("The server did not answer.");
    expect(h.result.current.rows.map((r) => r.node)).toEqual(["a"]);
    act(() => h.result.current.retry());
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2].cursor).toBe("c2");
    await act(async () => calls[2].resolve(page(["b"], null)));
    expect(h.result.current.error).toBeNull();
    expect(h.result.current.rows.map((r) => r.node)).toEqual(["a", "b"]);
  });

  it("a first-page error then retry loads the first page again", async () => {
    const h = setup();
    await act(async () => calls[0].reject(new Error("The server did not answer.")));
    expect(h.result.current.error).toBe("The server did not answer.");
    act(() => h.result.current.retry());
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(h.result.current.loading).toBe(true);
    await act(async () => calls[1].resolve(page(["a"], null)));
    expect(h.result.current.error).toBeNull();
    expect(h.result.current.rows).toHaveLength(1);
  });

  it("returning to an earlier query starts again at its first page", async () => {
    const h = setup({ q: "a" });
    await act(async () => calls[0].resolve(page(["a1"], "c2")));
    act(() => h.result.current.loadMore());
    await waitFor(() => expect(calls).toHaveLength(2));
    await act(async () => calls[1].resolve(page(["a2"], null)));
    h.rerender({ q: { q: "b" } });
    await act(async () => calls[2].resolve(page(["b1"], null)));
    h.rerender({ q: { q: "a" } });
    const back = calls[calls.length - 1];
    expect(back.query.q).toBe("a");
    expect(back.cursor).toBeNull();
    await act(async () => back.resolve(page(["a1"], "c2")));
    expect(h.result.current.rows.map((r) => r.node)).toEqual(["a1"]);
  });
});
