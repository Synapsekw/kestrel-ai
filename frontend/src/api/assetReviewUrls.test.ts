import { describe, expect, it } from "vitest";
import { brandLogoUrl, placementLabelsUrl, placementMeshUrl, placementTextureUrl } from "@contract/client";

const BASE = "http://127.0.0.1:8765/";

describe("asset review URL builders", () => {
  it("put the token in the query, since <img> and fetch-by-URL cannot send headers", () => {
    const p = "http://127.0.0.1:8765/api/v1/projects/p1/asset-models/m1/placements/s1";
    expect(placementMeshUrl(BASE, "t k", "p1", "m1", "s1")).toBe(`${p}/mesh?token=t+k`);
    expect(placementTextureUrl(BASE, "t k", "p1", "m1", "s1")).toBe(`${p}/texture?token=t+k`);
    expect(placementLabelsUrl(BASE, "t k", "p1", "m1", "s1")).toBe(`${p}/labels?token=t+k`);
  });

  it("serves brand logos from the app-wide brands API", () => {
    expect(brandLogoUrl(BASE, "tok", "b1", "on_dark")).toBe(
      "http://127.0.0.1:8765/api/v1/brands/b1/logos/on_dark?token=tok",
    );
  });
});
