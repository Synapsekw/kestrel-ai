import { describe, expect, it, vi } from "vitest";
import { fromLonLat } from "ol/proj";
import type { GeoMap } from "@contract/client";
import { exampleGeoMap } from "@/test/fixtures";
import { DEFAULT_SEVERITY_SCALE } from "@/ui";
import {
  flightPath,
  footprintShape,
  gpsPoints,
  idsInExtent,
  pickBackground,
  pointStyle,
  projector,
  throttle,
  type CapturePoint,
} from "./captureModel";
import { makeIndexState } from "./testing";

const ortho = (over: Partial<GeoMap>): GeoMap => ({
  ...exampleGeoMap,
  status: "ready",
  proj4: "+proj=longlat +datum=WGS84 +no_defs",
  geotransform: [55.0, 0.001, 0, 25.5, 0, -0.001],
  width: 1000,
  height: 1000,
  bounds_wgs84: [55.0, 24.5, 56.0, 25.5],
  ...over,
});

const pts = (coords: [number, number][]): CapturePoint[] =>
  coords.map(([lon, lat], i) => ({ ordinal: i, id: `p${i}`, lon, lat, sev: 0, count: 0 }));

describe("capture model", () => {
  it("keeps only images with GPS, in index order", () => {
    const p = gpsPoints(makeIndexState(10));
    expect(p.map((x) => x.ordinal)).toEqual([0, 3, 6, 9]);
    expect(p[0]).toMatchObject({ id: "img-0", sev: 3, count: 2 });
  });

  it("picks the newest ready ortho covering more than half the points", () => {
    const inside = pts([
      [55.2, 25.2],
      [55.3, 25.3],
      [57, 26],
    ]);
    const older = ortho({ id: "old", captured_on: "2026-01-01" });
    const newer = ortho({ id: "new", captured_on: "2026-06-01" });
    const elsewhere = ortho({ id: "far", captured_on: "2026-09-01", bounds_wgs84: [10, 10, 11, 11] });
    const processing = ortho({
      id: "wip",
      captured_on: "2026-09-02",
      status: "importing" as GeoMap["status"],
    });
    expect(pickBackground([older, newer, elsewhere, processing], inside)?.id).toBe("new");
    expect(
      pickBackground(
        [older],
        pts([
          [55.2, 25.2],
          [57, 26],
        ]),
      ),
    ).toBeNull(); // exactly half
    expect(pickBackground([older], [])).toBeNull();
  });

  it("projects to mercator, or to the ortho's pixel grid (y flipped)", () => {
    expect(projector({ kind: "mercator" })(55.29, 25.26)).toEqual(fromLonLat([55.29, 25.26]));
    const px = projector({ kind: "ortho", map: ortho({}) })(55.1, 25.4)!;
    expect(px[0]).toBeCloseTo(100);
    expect(px[1]).toBeCloseTo(-100);
    // Outside the ortho is still placed (unclamped), unlike the Overview's pins.
    expect(projector({ kind: "ortho", map: ortho({}) })(54.9, 25.6)).not.toBeNull();
  });

  it("colours points by worst severity, grey without, and sizes them by findings", () => {
    const s = pointStyle(DEFAULT_SEVERITY_SCALE, "#777777");
    expect(s["circle-radius"]).toEqual(["case", [">", ["get", "count"], 0], 2.6, 1.4]);
    expect(s["circle-fill-color"]).toEqual([
      "match",
      ["get", "sev"],
      4,
      "#ff5a4f",
      3,
      "#ff9c3a",
      2,
      "#e2bf2e",
      1,
      "#3fb68e",
      "#777777",
    ]);
    expect(pointStyle([], "#777777")["circle-fill-color"]).toBe("#777777");
  });

  it("draws the flight path only in capture order", () => {
    const coords = [[0, 0], null, [1, 1], [2, 2]];
    expect(flightPath(coords, "capture_time")).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
    expect(flightPath(coords, "path")).toBeNull();
    expect(flightPath([[0, 0]], "capture_time")).toBeNull();
  });

  it("turns a footprint into a polygon ring or a heading tick", () => {
    const id = (lon: number, lat: number) => [lon, lat];
    const ring = [
      [1, 2],
      [3, 2],
      [3, 0],
      [1, 0],
      [1, 2],
    ];
    expect(
      footprintShape(
        { kind: "trapezoid", geometry: { type: "Polygon", coordinates: [ring] }, yawDeg: 0 },
        id,
      ),
    ).toEqual({
      kind: "polygon",
      ring,
    });
    expect(
      footprintShape({ kind: "point", geometry: { type: "Point", coordinates: [5, 6] }, yawDeg: 90 }, id),
    ).toEqual({
      kind: "tick",
      at: [5, 6],
      rotation: Math.PI / 2,
    });
    expect(
      footprintShape({ kind: "point", geometry: { type: "Point", coordinates: [5, 6] }, yawDeg: null }, id),
    ).toBeNull();
    expect(footprintShape({ kind: "none", geometry: null, yawDeg: null }, id)).toBeNull();
    expect(footprintShape(null, id)).toBeNull();
  });

  it("finds the points inside a lasso extent", () => {
    const p = pts([
      [0, 0],
      [5, 5],
      [9, 9],
    ]);
    expect(idsInExtent(p, [[0, 0], [5, 5], null], [1, 1, 10, 10])).toEqual(["p1"]);
  });

  it("throttles hover to one call per interval", () => {
    let t = 0;
    const fn = vi.fn();
    const h = throttle(fn, 33, () => t);
    h(1);
    t = 10;
    h(2);
    t = 40;
    h(3);
    expect(fn.mock.calls).toEqual([[1], [3]]);
  });
});
