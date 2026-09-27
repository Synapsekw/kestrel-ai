import { describe, expect, it } from "vitest";
import {
  drawingPageThumbnailUrl,
  drawingThumbnailUrl,
  drawingVectorTileUrl,
  siteTileUrl,
} from "@contract/client";

describe("map-workspace URLs", () => {
  it("builds a site tile template with the token, the version and the style", () => {
    expect(
      siteTileUrl("http://h:1/", "t k", "p1", "surface", "s1", "v2", {
        style: "contours",
        interval: "0.5",
      }),
    ).toBe(
      "http://h:1/api/v1/projects/p1/site-tiles/surface/s1/{z}/{x}/{y}?token=t+k&v=v2&style=contours&interval=0.5",
    );
  });

  it("builds a drawing vector tile template", () => {
    expect(drawingVectorTileUrl("http://h:1", "t", "p1", "w1", "3")).toBe(
      "http://h:1/api/v1/projects/p1/drawings/w1/vtiles/{z}/{x}/{y}?token=t&v=3",
    );
  });

  it("builds the drawing thumbnails", () => {
    expect(drawingThumbnailUrl("http://h:1", "t", "p1", "w1")).toBe(
      "http://h:1/api/v1/projects/p1/drawings/w1/thumbnail?token=t",
    );
    expect(drawingPageThumbnailUrl("http://h:1", "t", "p1", "i1", 2)).toBe(
      "http://h:1/api/v1/projects/p1/drawing-inspections/i1/pages/2/thumbnail?token=t",
    );
  });
});
