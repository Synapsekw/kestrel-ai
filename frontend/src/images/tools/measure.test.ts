import { describe, expect, it } from "vitest";
import {
  convexHull,
  feret,
  formatArea,
  formatLength,
  lengthLabel,
  measureShape,
  polygonArea,
  scaleFromCamera,
  sigmaAreaM2,
  sigmaLengthMm,
  type CameraScale,
} from "./measure";

const hexagon = (r: number) =>
  Array.from({ length: 6 }, (_, i) => ({ x: r * Math.cos((Math.PI / 3) * i), y: r * Math.sin((Math.PI / 3) * i) }));
const scale: CameraScale = { gsdMm: 2, distanceM: 40, sigmaM: 1, source: "rel_alt" };

describe("Feret diameters (rotating calipers on the hull)", () => {
  it("on a regular hexagon: max is 2r, min is √3·r", () => {
    const { max, min } = feret(hexagon(10));
    expect(max).toBeCloseTo(20);
    expect(min).toBeCloseTo(10 * Math.sqrt(3));
  });

  it("ignores interior points and concavities", () => {
    const withInside = [...hexagon(10), { x: 0, y: 0 }, { x: 1, y: 2 }];
    expect(convexHull(withInside)).toHaveLength(6);
    expect(feret(withInside).max).toBeCloseTo(20);
  });
});

describe("areas and uncertainty", () => {
  it("computes the shoelace area", () => {
    expect(polygonArea(hexagon(10))).toBeCloseTo((3 * Math.sqrt(3) / 2) * 100);
    expect(polygonArea([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }])).toBeCloseTo(6);
  });

  it("σ_L = L·σ_D/D + √2·gsd and σ_A = 2A·σ_D/D", () => {
    expect(sigmaLengthMm(1000, scale)).toBeCloseTo(25 + 2 * Math.SQRT2);
    expect(sigmaAreaM2(0.5, scale)).toBeCloseTo(0.025);
  });
});

describe("camera scale", () => {
  it("is null without a GSD or a distance, so the UI shows px", () => {
    expect(scaleFromCamera(null)).toBeNull();
    expect(scaleFromCamera({ gsd_mm: null, distance_m: 40, distance_sigma_m: 1, distance_source: "rel_alt" })).toBeNull();
    expect(scaleFromCamera({ gsd_mm: 2, distance_m: null, distance_sigma_m: null, distance_source: null })).toBeNull();
    expect(scaleFromCamera({ gsd_mm: 2, distance_m: 40, distance_sigma_m: 1, distance_source: "lrf" })).toEqual({
      gsdMm: 2,
      distanceM: 40,
      sigmaM: 1,
      source: "lrf",
    });
  });
});

describe("labels", () => {
  it("formats lengths and areas", () => {
    expect(formatLength(412.4)).toBe("412 mm");
    expect(formatLength(1234)).toBe("1.23 m");
    expect(formatArea(0.5)).toBe("0.50 m²");
    expect(formatArea(0.0042)).toBe("0.0042 m²");
  });

  it("shows mm ± σ with a scale and px without", () => {
    expect(lengthLabel(500, scale)).toBe("1.00 m ± 28 mm");
    expect(lengthLabel(231.4, null)).toBe("231 px");
  });
});

describe("measureShape tiles (spec §9.3 table)", () => {
  it("box: area primary, length and width secondary, the basis line", () => {
    const t = measureShape({ shape: "box", w: 500, h: 250, points: null }, scale);
    expect(t.primary).toMatchObject({ label: "Area", value: "0.50 m²" });
    expect(t.secondary.map((v) => [v.label, v.value])).toEqual([
      ["Length", "1.00 m"],
      ["Width", "500 mm"],
    ]);
    expect(t.basis).toBe("from GSD 2.0 mm/px · ±28 mm at 40.0 m");
  });

  it("polygon: shoelace area, max length and min width by Feret", () => {
    const pts = hexagon(100).map((p) => [p.x + 200, p.y + 200]);
    const t = measureShape({ shape: "polygon", w: 200, h: 173, points: pts }, scale);
    expect(t.secondary.map((v) => v.label)).toEqual(["Max length", "Min width"]);
    expect(t.secondary[0].value).toBe("400 mm");
  });

  it("point: no tiles, the point marker line", () => {
    expect(measureShape({ shape: "point", w: 0, h: 0, points: null }, scale)).toEqual({
      primary: null,
      secondary: [],
      basis: null,
      pointMarker: true,
    });
  });

  it("without a scale shows px and px² and no basis", () => {
    const t = measureShape({ shape: "rbox", w: 30, h: 10, points: null }, null);
    expect(t.primary).toEqual({ label: "Area", value: "300 px²", sigma: null });
    expect(t.secondary[0]).toEqual({ label: "Length", value: "30 px", sigma: null });
    expect(t.basis).toBeNull();
  });
});
