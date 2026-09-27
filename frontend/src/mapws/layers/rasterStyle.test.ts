import { describe, expect, it } from "vitest";
import { LOCAL, UTM33 } from "../test/fixtures";
import { parseRasterStyle, tileExtras } from "./rasterStyle";

describe("raster style", () => {
  it("defaults to hillshade with the automatic interval and rejects junk", () => {
    expect(parseRasterStyle({})).toEqual({
      render: "hillshade",
      interval: null,
    });
    expect(parseRasterStyle({ render: "contours", interval: 0.5 })).toEqual({
      render: "contours",
      interval: 0.5,
    });
    expect(parseRasterStyle({ render: "bogus", interval: -2 })).toEqual({
      render: "hillshade",
      interval: null,
    });
  });

  it("puts the frame key on every tile and style and interval on surfaces only (W2-12)", () => {
    expect(tileExtras("map", { render: "tint" }, UTM33)).toEqual({
      frame_key: "EPSG:32633",
    });
    expect(tileExtras("surface", {}, LOCAL)).toEqual({
      frame_key: "kestrel-local",
      style: "hillshade",
    });
    expect(tileExtras("surface", { render: "tint", interval: 2 }, UTM33)).toEqual({
      frame_key: "EPSG:32633",
      style: "tint",
    });
    expect(tileExtras("surface", { render: "contours", interval: 0.5 }, UTM33)).toEqual({
      frame_key: "EPSG:32633",
      style: "contours",
      interval: "0.5",
    });
  });
});
