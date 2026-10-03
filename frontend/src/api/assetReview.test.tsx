// src/api/assetReview.test.tsx
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { TestApiProvider } from "@/test/render";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import {
  POSES_PAGE,
  computePlacements,
  estimatePoses,
  mergeFinding,
  putImageReview,
  regroup,
  splitFinding,
  useAssetFindings,
  usePlacements,
  usePoses,
} from "./assetReview";

const pose = (id: string) => ({
  image_id: id,
  position: [1, 2, 3],
  target: [0, 0, 0],
  up: [0, 1, 0],
  hfov_deg: 70,
  vfov_deg: 52,
  source: "kit",
  accuracy_m: null,
  sequence: "A",
  outcome: "finding",
  updated_at: "2026-10-03T00:00:00Z",
});
const job = { id: "j1", type: "asset_place", state: "queued" };

function wrap(api: Parameters<typeof TestApiProvider>[0]["api"]) {
  return ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
}

describe("asset review hooks", () => {
  it("usePoses pages with after and limit until next is null", async () => {
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/asset-models\/m1\/poses$/,
        body: (r) =>
          r.url.includes("after=c1")
            ? { items: [pose("i3")], next: null }
            : { items: [pose("i1"), pose("i2")], next: "c1" },
      },
    ]);
    const { result } = renderHook(() => usePoses(PROJECT_ID, "m1"), { wrapper: wrap(api) });
    await waitFor(() => expect(result.current.done).toBe(true));
    expect(result.current.items.map((p) => p.image_id)).toEqual(["i1", "i2", "i3"]);
    const urls = requests.filter((r) => r.url.includes("/poses")).map((r) => r.url);
    expect(urls).toHaveLength(2);
    expect(urls.every((u) => u.includes(`limit=${POSES_PAGE}`))).toBe(true);
    expect(urls[1]).toContain("after=c1");
  });

  it("stops when the mock repeats a cursor, and keeps the version of the placements index", async () => {
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/placements$/,
        body: { version: 3, items: [{ sighting_id: "s1" }], next: "string" },
      },
    ]);
    const { result } = renderHook(() => usePlacements(PROJECT_ID, "m1"), { wrapper: wrap(api) });
    await waitFor(() => expect(result.current.done).toBe(true));
    expect(result.current.version).toBe(3);
    expect(requests.filter((r) => r.url.includes("/placements")).length).toBe(2);
  });

  it("useAssetFindings pages findings of one model with cursor and limit 500", async () => {
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/findings$/,
        body: (r) =>
          r.url.includes("cursor=n2")
            ? { items: [{ id: "f2" }], next_cursor: null }
            : { items: [{ id: "f1" }], next_cursor: "n2" },
      },
    ]);
    const { result } = renderHook(() => useAssetFindings(PROJECT_ID, "m1", { sort: "-severity" }), {
      wrapper: wrap(api),
    });
    await waitFor(() => expect(result.current.done).toBe(true));
    expect(result.current.items.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(requests[0].url).toContain("asset_model_id=m1");
    expect(requests[0].url).toContain("limit=500");
  });

  it("reports a failed page as an error and keeps what arrived", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/poses$/,
        status: 500,
        body: { error: { code: "internal", message: "boom", details: {} } },
      },
    ]);
    const { result } = renderHook(() => usePoses(PROJECT_ID, "m1"), { wrapper: wrap(api) });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.items).toEqual([]);
  });
});

describe("asset review actions", () => {
  it("starts the jobs on the slash-verb paths and returns the job", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/poses\/estimate$/, status: 202, body: { job } },
      { method: "POST", path: /\/placements\/compute$/, status: 202, body: { job } },
      { method: "POST", path: /\/findings\/regroup$/, status: 202, body: { job } },
    ]);
    expect((await estimatePoses(api, PROJECT_ID, "m1")).id).toBe("j1");
    expect((await computePlacements(api, PROJECT_ID, "m1", true)).id).toBe("j1");
    expect((await regroup(api, PROJECT_ID, "m1")).id).toBe("j1");
    expect(requests.map((r) => [r.url.replace(/^.*asset-models\/m1/, ""), r.body])).toEqual([
      ["/poses/estimate", {}],
      ["/placements/compute", { only_dirty: true }],
      ["/findings/regroup", null],
    ]);
  });

  it("merges, splits and sets a photo review", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/findings\/f1\/merge$/, body: { id: "f2" } },
      { method: "POST", path: /\/findings\/f1\/split$/, body: { id: "f9" } },
      { method: "PUT", path: /\/images\/i1\/review$/, body: { image_id: "i1", status: "uncertain" } },
    ]);
    expect((await mergeFinding(api, PROJECT_ID, "f1", "f2")).id).toBe("f2");
    expect((await splitFinding(api, PROJECT_ID, "f1", ["s1"])).id).toBe("f9");
    expect((await putImageReview(api, PROJECT_ID, "i1", { status: "uncertain" })).status).toBe("uncertain");
    expect(requests.map((r) => r.body)).toEqual([
      { into: "f2" },
      { sighting_ids: ["s1"] },
      { status: "uncertain" },
    ]);
  });
});
