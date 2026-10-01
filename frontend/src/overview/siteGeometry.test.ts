import { describe, expect, it } from "vitest";
import { exampleSite, noSite } from "@/test/findingFixtures";
import { niceScale, siteFrame } from "./siteGeometry";

describe("siteFrame", () => {
  it("is null without any geometry", () => {
    expect(siteFrame(noSite)).toBeNull();
  });

  it("puts north up and keeps the aspect with cos(latitude)", () => {
    const f = siteFrame(exampleSite)!;
    const [minlon, minlat, maxlon, maxlat] = exampleSite.bounds_wgs84!;
    const sw = f.project(minlon, minlat);
    const ne = f.project(maxlon, maxlat);
    expect(ne.y).toBeLessThan(sw.y); // north is up
    expect(ne.x).toBeGreaterThan(sw.x);
    const ratio = (ne.x - sw.x) / (sw.y - ne.y);
    expect(ratio).toBeCloseTo(
      ((maxlon - minlon) * Math.cos((44.8125 * Math.PI) / 180)) / (maxlat - minlat),
      3,
    );
  });

  it("pads a single photo point so the frame is never zero-sized", () => {
    const f = siteFrame({ ...exampleSite, bounds_wgs84: [20, 44, 20, 44], center: [20, 44] })!;
    expect(f.width).toBeGreaterThan(0);
    expect(f.height).toBeGreaterThan(0);
  });
});

describe("niceScale", () => {
  it("picks a round length near a quarter of the width", () => {
    expect(niceScale(480)).toEqual({ metres: 100, label: "100 m" });
    expect(niceScale(9000)).toEqual({ metres: 2000, label: "2 km" });
  });
});
