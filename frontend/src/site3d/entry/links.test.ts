import { describe, expect, it } from "vitest";
import { modelDetailsHref, readSiteAt, siteHref } from "./links";

describe("site links", () => {
  it("opens the site view, optionally on a model and at a spot in the caller's CRS", () => {
    expect(siteHref("p1")).toBe("/p/p1/site");
    expect(siteHref("p1", "m1")).toBe("/p/p1/site/m1");
    expect(siteHref("p1", null, { x: 244400.5, y: 3179600.254, epsg: 32639 })).toBe(
      "/p/p1/site?at=244400.50,3179600.25&epsg=32639",
    );
    expect(siteHref("p1", "m1", { x: 1, y: 2, epsg: null })).toBe("/p/p1/site/m1?at=1.00,2.00");
    expect(siteHref("p1", "m1", { x: Number.NaN, y: 2, epsg: null })).toBe("/p/p1/site/m1");
  });
  it("reads ?at= and ?epsg= back, and nothing from junk", () => {
    expect(readSiteAt("?at=244400.50,3179600.25&epsg=32639")).toEqual({
      x: 244400.5,
      y: 3179600.25,
      epsg: 32639,
    });
    expect(readSiteAt("?at=1,2")).toEqual({ x: 1, y: 2, epsg: null });
    expect(readSiteAt("?at=1")).toBeNull();
    expect(readSiteAt("")).toBeNull();
  });
  it("the model's own workspace stays reachable for a plant", () => {
    expect(modelDetailsHref("p1", "m1")).toBe("/p/p1/models/m1?view=model");
  });
});
