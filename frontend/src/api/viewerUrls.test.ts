import { describe, expect, it } from "vitest";
import { cloudOctreeUrl, surfaceOrthoTileUrl, surfaceTileUrl, volumeDiffTileUrl } from "@contract/client";

const BASE = "http://127.0.0.1:8765/";

describe("viewer URL helpers (foundation F0)", () => {
  it("points the octree loader at metadata.json with no token, for the RequestManager to add", () => {
    const url = cloudOctreeUrl(BASE, "p1", "c1");
    expect(url).toBe("http://127.0.0.1:8765/api/v1/projects/p1/pointclouds/c1/octree/metadata.json");
    // potree-core derives the other two files this way; the base must survive it.
    expect(url.replace("/metadata.json", "/octree.bin")).toBe(
      "http://127.0.0.1:8765/api/v1/projects/p1/pointclouds/c1/octree/octree.bin",
    );
  });

  it("templates surface hillshade tiles, tinted on request", () => {
    expect(surfaceTileUrl(BASE, "t k", "p1", "s1")).toBe(
      "http://127.0.0.1:8765/api/v1/projects/p1/surfaces/s1/tiles/{z}/{x}/{y}?token=t+k",
    );
    expect(surfaceTileUrl(BASE, "t", "p1", "s1", true)).toBe(
      "http://127.0.0.1:8765/api/v1/projects/p1/surfaces/s1/tiles/{z}/{x}/{y}?token=t&tint=true",
    );
  });

  it("templates the ortho underlay with its map", () => {
    expect(surfaceOrthoTileUrl(BASE, "t", "p1", "s1", "m1")).toBe(
      "http://127.0.0.1:8765/api/v1/projects/p1/surfaces/s1/ortho-tiles/{z}/{x}/{y}?token=t&map_id=m1",
    );
  });

  it("templates cut/fill tiles with the cache-busting version when there is one", () => {
    expect(volumeDiffTileUrl(BASE, "t", "p1", "v1")).toBe(
      "http://127.0.0.1:8765/api/v1/projects/p1/volumes/v1/diff-tiles/{z}/{x}/{y}?token=t",
    );
    expect(volumeDiffTileUrl(BASE, "t", "p1", "v1", "2026-09-24T10:00:00Z")).toBe(
      "http://127.0.0.1:8765/api/v1/projects/p1/volumes/v1/diff-tiles/{z}/{x}/{y}?token=t&v=2026-09-24T10%3A00%3A00Z",
    );
  });
});
