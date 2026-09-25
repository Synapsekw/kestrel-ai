import { describe, expect, it } from "vitest";
import { exampleCloud } from "@/test/cloudFixtures";
import { formatLength, makePickReadout } from "./readout";

const pick = { x: 243522.1234, y: 3178252.4567, z: -44.3211, level: 7, uncertainty_m: 0.032 };

describe("pick readout", () => {
  it("shows native coordinates to the millimetre and WGS84 to 8 decimals", () => {
    const r = makePickReadout(exampleCloud)(pick);
    expect(r.native).toBe("E 243522.123 · N 3178252.457 · Z -44.321 · EPSG:32639");
    expect(r.wgs84).toMatch(/^28\.\d{8}° N, 48\.\d{8}° E$/);
    expect(r.zLabel).toBe("Z as stored (no vertical datum)");
    expect(r.precision).toBe("point exact to 1 mm (file scale) · pick ± 3.2 cm at this zoom");
    expect(r.warn).toBe(false);
  });

  it("hides WGS84 without coordinates, names a vertical datum, warns above 10 cm", () => {
    const bare = makePickReadout({
      ...exampleCloud,
      proj4: null,
      epsg: null,
      crs_wkt: null,
      vertical_crs: null,
    });
    expect(bare({ ...pick, uncertainty_m: 0.2 }).wgs84).toBeNull();
    expect(bare({ ...pick, uncertainty_m: 0.2 }).warn).toBe(true);
    expect(bare({ ...pick, uncertainty_m: 0.2 }).precision).toBe(
      "point exact to 1 mm (file scale) · pick ± 20.0 cm at this zoom — zoom in to refine",
    );
    expect(makePickReadout({ ...exampleCloud, vertical_crs: "EGM96 height" })(pick).zLabel).toBe(
      "Z in EGM96 height",
    );
  });

  it("formats lengths", () => {
    expect(formatLength(0.001)).toBe("1 mm");
    expect(formatLength(0.032)).toBe("3.2 cm");
    expect(formatLength(13)).toBe("13.000 m");
  });
});
