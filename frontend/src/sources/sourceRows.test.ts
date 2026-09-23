import { describe, expect, it } from "vitest";
import type { GeoMap, Source } from "@contract/client";
import type { RunSummary } from "@/api/sources";
import { exampleGeoMap, exampleSource } from "@/test/fixtures";
import { buildRows, runLine, sizeLine } from "./sourceRows";

const photos = (
  id: string,
  captured_on: string | null,
  created_at: string,
  extra: Partial<Source> = {},
): Source => ({
  ...exampleSource,
  id,
  captured_on,
  created_at,
  ...extra,
});

const run = (over: Partial<RunSummary>): RunSummary => ({
  id: "r1",
  kind: "map",
  source_id: "s-map",
  source_label: null,
  model_id: "m1",
  model_name: "machinery-v3",
  conf: 0.25,
  job_state: "succeeded",
  pinned: false,
  counts: { a: 42, b: 17 },
  verified_counts: { a: 30 },
  review: { total: 59, reviewed: 34 },
  created_at: "2026-09-22T11:00:00Z",
  ...over,
});

describe("buildRows", () => {
  it("puts the newest survey first and undated sources after the dated ones, newest import first", () => {
    const rows = buildRows(
      [
        photos("old", "2026-04-15", "2026-04-16T00:00:00Z"),
        photos("undated-old", null, "2026-01-01T00:00:00Z"),
        photos("new", "2026-09-14", "2026-09-15T00:00:00Z"),
        photos("undated-new", null, "2026-09-20T00:00:00Z"),
      ],
      [],
      new Map(),
    );
    expect(rows.map((r) => r.key)).toEqual(["new", "old", "undated-new", "undated-old"]);
  });

  it("joins a map source to its map, and lists a map that has no source by the map row", () => {
    const linked: GeoMap = { ...exampleGeoMap, id: "m-linked", name: "May ortho" };
    const legacy: GeoMap = { ...exampleGeoMap, id: "m-old", name: "Old ortho", captured_on: "2025-01-02" };
    const source = photos("s-map", "2026-05-20", "2026-05-21T00:00:00Z", {
      kind: "map",
      label: "May survey",
      map_id: "m-linked",
    });
    const rows = buildRows([source], [linked, legacy], new Map());
    expect(rows.map((r) => [r.key, r.kind, r.label, r.capturedOn, r.map?.id])).toEqual([
      ["s-map", "map", "May survey", "2026-05-20", "m-linked"],
      ["map:m-old", "map", "Old ortho", "2025-01-02", "m-old"],
    ]);
    expect(rows[1].source).toBeNull();
  });

  it("falls back to the map name, then the site, when a source has no label", () => {
    const map: GeoMap = { ...exampleGeoMap, id: "m1", name: "site-ortho" };
    const rows = buildRows(
      [
        photos("p", null, "2026-09-01T00:00:00Z", { label: null, site: "ahmadia" }),
        photos("m", null, "2026-08-01T00:00:00Z", { kind: "map", label: null, map_id: "m1" }),
      ],
      [map],
      new Map(),
    );
    expect(rows.map((r) => r.label)).toEqual(["ahmadia", "site-ortho"]);
  });

  it("attaches each source's chosen run", () => {
    const chosen = run({ source_id: "p" });
    const rows = buildRows([photos("p", null, "2026-09-01T00:00:00Z")], [], new Map([["p", chosen]]));
    expect(rows[0].run).toBe(chosen);
  });
});

describe("runLine", () => {
  it("counts objects on a map and detections in photos, with verified and review progress", () => {
    expect(runLine(run({}), "map")).toEqual({
      model: "machinery-v3",
      counts: "59 objects (30 verified)",
      review: "34 of 59 reviewed",
    });
    expect(
      runLine(run({ counts: { a: 1 }, verified_counts: {}, review: { total: 1, reviewed: 0 } }), "images"),
    ).toEqual({ model: "machinery-v3", counts: "1 detection (0 verified)", review: "0 of 1 reviewed" });
  });

  it("names a run without a model by its provider-less fallback", () => {
    expect(runLine(run({ model_name: null }), "map").model).toBe("Unnamed model");
  });
});

describe("sizeLine", () => {
  it("counts photos, and gives a map's size and ground resolution", () => {
    expect(sizeLine(photos("p", null, "2026-09-01T00:00:00Z", { image_count: 1 }), null)).toBe("1 photo");
    expect(sizeLine(photos("p", null, "2026-09-01T00:00:00Z", { image_count: 3299 }), null)).toBe(
      "3,299 photos",
    );
    const map: GeoMap = { ...exampleGeoMap, width: 1200, height: 700, gsd_cm: 3 };
    expect(sizeLine(null, map)).toBe("1,200 × 700 px · 3.0 cm/px");
    expect(sizeLine(null, { ...map, gsd_cm: null })).toBe("1,200 × 700 px");
  });
});
