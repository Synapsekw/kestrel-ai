import { describe, expect, it } from "vitest";
import { fakeClient } from "@/test/fixtures";
import { CATALOGUE, PACKAGES, itemRow } from "@/test/plantFixtures";
import { getCatalogue, listAssetItems, listRunPackages } from "./plantItems";

describe("plant item API", () => {
  it("reads one page of items with the trimmed query, the cursor and a 200-row limit", async () => {
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/asset-models\/m1\/versions\/3\/items$/,
        body: { items: [itemRow()], next_cursor: "c2" },
      },
    ] as never);
    const page = await listAssetItems(
      api,
      "p",
      "m1",
      3,
      { q: " 20-T ", type: "", area: "20", flag: "height_mismatch" },
      "c1",
    );
    expect(page.items).toHaveLength(1);
    expect(page.next_cursor).toBe("c2");
    const q = new URL(requests[0].url, "http://x").searchParams;
    expect(q.get("q")).toBe("20-T");
    expect(q.has("type")).toBe(false);
    expect(q.get("area")).toBe("20");
    expect(q.get("flag")).toBe("height_mismatch");
    expect(q.get("cursor")).toBe("c1");
    expect(q.get("limit")).toBe("200");
  });

  it("the first page has no cursor", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/items$/, body: { items: [], next_cursor: null } },
    ] as never);
    await listAssetItems(api, "p", "m1", 3, {}, null);
    expect(new URL(requests[0].url, "http://x").searchParams.has("cursor")).toBe(false);
  });

  it("reads the builder catalogue, which is not project-scoped", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /^\/api\/v1\/asset-models\/catalogue$/, body: { types: CATALOGUE } },
    ] as never);
    expect((await getCatalogue(api)).map((c) => c.type)).toEqual(["tank_lng", "other"]);
    expect(requests[0].url).toBe("/api/v1/asset-models/catalogue");
  });

  it("reads a run's packages", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/asset-models\/m1\/runs\/r1\/packages$/, body: { items: PACKAGES } },
    ] as never);
    expect((await listRunPackages(api, "p", "m1", "r1")).map((k) => k.label)).toEqual([
      "Jetty head 1",
      "Tank row north",
      "Process area",
    ]);
  });
});
