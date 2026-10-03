import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  ASSET_MODEL_ID,
  exampleAssetFinding,
  exampleAssetFinding2,
  exampleUnplacedAssetFinding,
} from "@/test/assetFindingFixtures";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { MAP_DOTS_MAX, MAP_DOTS_PAGE, fetchMapDots, toMapDot, useAssetMapDots } from "./useAssetMapDots";

describe("toMapDot", () => {
  it("keeps a placed finding's map facts and drops an unplaced one", () => {
    expect(toMapDot(exampleAssetFinding)).toEqual({
      id: exampleAssetFinding.id,
      number: 401,
      severity: 3,
      height_m: 42.5,
      bearing_deg: 90,
      side: "E",
      zone: "shaft",
    });
    expect(toMapDot(exampleUnplacedAssetFinding)).toBeNull();
  });
});

describe("fetchMapDots", () => {
  it("asks for this model's placed, not closed findings and pages with the cursor", async () => {
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/findings$/,
        body: (req) =>
          new URL(req.url, "http://fake").searchParams.get("cursor") === "c2"
            ? { items: [exampleAssetFinding2], next_cursor: null }
            : { items: [exampleAssetFinding, exampleUnplacedAssetFinding], next_cursor: "c2" },
      },
    ]);
    const r = await fetchMapDots(api, PROJECT_ID, ASSET_MODEL_ID);
    expect(r).toEqual({
      dots: [toMapDot(exampleAssetFinding), toMapDot(exampleAssetFinding2)],
      truncated: false,
    });
    const q = new URL(requests[0].url, "http://fake").searchParams;
    expect(q.get("asset_model_id")).toBe(ASSET_MODEL_ID);
    expect(q.get("placed")).toBe("true");
    expect(q.getAll("status")).toEqual(["open", "reviewed"]);
    expect(q.get("limit")).toBe(String(MAP_DOTS_PAGE));
    expect(requests).toHaveLength(2);
  });

  it("stops at the cap and says so", async () => {
    let n = 0;
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/findings$/,
        body: () => {
          n += 1;
          const items = Array.from({ length: MAP_DOTS_PAGE }, (_, i) => ({
            ...exampleAssetFinding,
            id: `f-${n}-${i}`,
          }));
          return { items, next_cursor: `c${n + 1}` };
        },
      },
    ]);
    const r = await fetchMapDots(api, PROJECT_ID, ASSET_MODEL_ID);
    expect(r.truncated).toBe(true);
    expect(r.dots).toHaveLength(MAP_DOTS_MAX);
    expect(requests).toHaveLength(MAP_DOTS_MAX / MAP_DOTS_PAGE);
  });

  it("a repeated cursor (the Prism mock) ends paging", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/findings$/, body: { items: [exampleAssetFinding], next_cursor: "same" } },
    ]);
    const r = await fetchMapDots(api, PROJECT_ID, ASSET_MODEL_ID);
    expect(r.truncated).toBe(false);
    expect(requests).toHaveLength(2);
  });
});

describe("useAssetMapDots", () => {
  it("re-reads on findings.changed without dropping the dots it shows", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/findings$/, body: { items: [exampleAssetFinding], next_cursor: null } },
    ]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>{children}</TestApiProvider>
    );
    const { result } = renderHook(() => useAssetMapDots(PROJECT_ID, ASSET_MODEL_ID), { wrapper });
    await waitFor(() => expect(result.current.dots).toHaveLength(1));
    act(() => useChangesStore.setState((s) => ({ findingsRevision: s.findingsRevision + 1 })));
    expect(result.current.dots).toHaveLength(1);
    await waitFor(() => expect(requests).toHaveLength(2));
  });
});
