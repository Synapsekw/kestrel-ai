import { describe, expect, it } from "vitest";
import { exampleGeoMap, PROJECT_ID } from "@/test/fixtures";
import { emptyOverview, exampleFinding, fullOverview, SEVERITY_SCALE } from "@/test/findingFixtures";
import { buildKpis, formatCoords, headerFigures, severityRows, type Kpi } from "./kpis";
import { backdropLayout, lonLatToMapPixel, pinsFromFindings, type PinInput } from "./heroPins";

const TODAY = "2026-09-26";

describe("buildKpis (F §9.1)", () => {
  it("builds the four tiles of a full project", () => {
    const [open, top, data, volume] = buildKpis(fullOverview, SEVERITY_SCALE, PROJECT_ID, TODAY);
    expect(open).toMatchObject({
      id: "open",
      label: "Open findings",
      value: 47,
      delta: { value: 6, good: "down", label: "vs 7 days ago" },
      href: `/p/${PROJECT_ID}/findings?status=open`,
    });
    expect(open.spark).toHaveLength(30);
    expect(open.spark?.at(-1)).toBe(47);
    expect(top).toMatchObject({
      id: "top",
      label: "Critical",
      value: 5,
      tone: "danger",
      delta: { value: -2, good: "down", label: "closed this week" },
      href: `/p/${PROJECT_ID}/findings?status=open&severity=4`,
    });
    expect(data).toMatchObject({ id: "data", label: "Project data", value: 1284, unit: "images" });
    expect(data.chips).toEqual(["3 maps", "2 clouds", "1 elevation"]);
    expect(volume).toMatchObject({ id: "volume", label: "Stockpile volume", value: 12480, unit: "m³" });
    expect(volume.delta).toEqual({ value: -3.2, good: "up", label: "% vs previous survey" });
  });

  it("falls back to Reviewed % without a volume, and stays calm when empty", () => {
    const kpis = buildKpis(emptyOverview, SEVERITY_SCALE, PROJECT_ID, TODAY);
    expect(kpis.map((k) => k.id)).toEqual(["open", "top", "data", "reviewed"]);
    expect(kpis[0]).toMatchObject({ value: 0, delta: undefined, spark: undefined });
    expect(kpis[1]).toMatchObject({ value: 0, tone: undefined, delta: undefined });
    expect(kpis[2].chips).toEqual([]);
    expect(kpis[3]).toMatchObject({ label: "Reviewed", value: 0, unit: "%" });
    const some = {
      ...emptyOverview,
      findings: { ...emptyOverview.findings, by_status: { open: 1, reviewed: 2, closed: 1 } },
    };
    // Reviewed % counts reviewed and closed findings (a closed finding was looked at): 3 of 4.
    expect(buildKpis(some, SEVERITY_SCALE, PROJECT_ID, TODAY)[3].value).toBe(75);
  });

  it("names the top tile after the highest level of an edited scale", () => {
    const scale = [...SEVERITY_SCALE, { level: 5, name: "Unsafe", colour: "#aa0000" }];
    const top = buildKpis(fullOverview, scale, PROJECT_ID, TODAY)[1];
    expect(top).toMatchObject({ label: "Unsafe", value: 0 });
  });

  it("shows a dash for stockpile volume when net_m3 is null, and skips the delta (F5)", () => {
    const o = { ...fullOverview, latest_volume: { ...fullOverview.latest_volume!, net_m3: null } };
    const volume = buildKpis(o, SEVERITY_SCALE, PROJECT_ID, TODAY)[3];
    expect(volume).toMatchObject({ id: "volume", label: "Stockpile volume", value: null, unit: "m³" });
    expect(volume.delta).toBeUndefined();
  });
});

describe("severityRows", () => {
  it("lists levels highest first, relative to the largest, with a No severity row when needed", () => {
    const rows = severityRows({ ...fullOverview.findings, open_no_severity: 3 }, SEVERITY_SCALE, PROJECT_ID);
    expect(rows.map((r) => [r.name, r.count])).toEqual([
      ["Critical", 5],
      ["Major", 14],
      ["Moderate", 19],
      ["Minor", 9],
      ["No severity", 3],
    ]);
    expect(rows[2].fraction).toBe(1);
    expect(rows[0].fraction).toBeCloseTo(5 / 19);
    expect(rows[0].href).toBe(`/p/${PROJECT_ID}/findings?status=open&severity=4`);
    expect(rows[4]).toMatchObject({
      colour: null,
      href: `/p/${PROJECT_ID}/findings?status=open&severity=none`,
    });
    expect(severityRows(fullOverview.findings, SEVERITY_SCALE, PROJECT_ID)).toHaveLength(4);
  });

  it("draws empty bars when nothing is open", () => {
    expect(
      severityRows(emptyOverview.findings, SEVERITY_SCALE, PROJECT_ID).every((r) => r.fraction === 0),
    ).toBe(true);
  });
});

describe("hero pins", () => {
  const geo = {
    ...exampleGeoMap,
    width: 1000,
    height: 1000,
    proj4: "+proj=longlat +datum=WGS84 +no_defs",
    geotransform: [47.76, 0.00001, 0, 29.5, 0, -0.00001],
  };

  it("projects lon/lat into the map's pixels, and rejects points off the map", () => {
    const px = lonLatToMapPixel(geo, 47.765, 29.495);
    expect(px?.[0]).toBeCloseTo(500, 3);
    expect(px?.[1]).toBeCloseTo(500, 3);
    expect(lonLatToMapPixel(geo, 47.9, 29.495)).toBeNull();
    expect(lonLatToMapPixel({ ...geo, geotransform: null }, 47.765, 29.495)).toBeNull();
  });

  it("keeps only located findings", () => {
    expect(pinsFromFindings([exampleFinding, { ...exampleFinding, id: "x", lon: null, lat: null }])).toEqual([
      { id: exampleFinding.id, number: 217, severity: 4, lon: 47.765, lat: 29.495 },
    ]);
  });

  it("spreads pins over the backdrop with a scale bar", () => {
    const pins: PinInput[] = [
      { id: "a", number: 1, severity: 4, lon: 47.76, lat: 29.49 },
      { id: "b", number: 2, severity: 1, lon: 47.77, lat: 29.49 },
    ];
    const { points, scale } = backdropLayout(pins);
    expect(points[0].yPct).toBeCloseTo(points[1].yPct);
    expect(points[1].xPct).toBeGreaterThan(points[0].xPct);
    expect(scale?.label).toMatch(/m$/);
  });

  it("lays out a single pin and identical coordinates without NaN", () => {
    const one = backdropLayout([{ id: "a", number: 1, severity: null, lon: 47.76, lat: 29.49 }]);
    expect(one.points[0]).toEqual({ id: "a", xPct: 50, yPct: 50 });
    expect(one.scale).not.toBeNull();
    const same = backdropLayout([
      { id: "a", number: 1, severity: 1, lon: 47.76, lat: 29.49 },
      { id: "b", number: 2, severity: 2, lon: 47.76, lat: 29.49 },
    ]);
    expect(same.points.every((p) => Number.isFinite(p.xPct) && Number.isFinite(p.yPct))).toBe(true);
    expect(backdropLayout([])).toEqual({ points: [], scale: null });
  });
});

describe("headerFigures", () => {
  it("drops zero and missing figures", () => {
    const k = (id: Kpi["id"], value: number | null): Kpi => ({ id, label: id, value });
    expect(
      headerFigures([k("open", 7), k("top", 0), k("data", 1284), k("volume", null)]).map((f) => f.id),
    ).toEqual(["open", "data"]);
  });
});

describe("formatCoords", () => {
  it("formats hemispheres", () => {
    expect(formatCoords(20.4612, 44.8125)).toBe("44.8125° N 20.4612° E");
    expect(formatCoords(-70.25, -33.5)).toBe("33.5000° S 70.2500° W");
  });
});
