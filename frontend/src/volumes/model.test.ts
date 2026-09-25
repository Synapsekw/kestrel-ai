import { describe, expect, it } from "vitest";
import { exampleMapRun } from "@/test/fixtures";
import { PROJECT_ID, exampleMeasurement, exampleSurface, otherFlightRun } from "@/test/volumeFixtures";
import {
  buildDefaults,
  buildRequest,
  exportState,
  formatM3,
  groupRuns,
  headline,
  labels,
  nativeToPixel,
  nextName,
  pixelToNative,
  staleText,
  uncertaintyText,
  viewIn3dHref,
  worstTone,
} from "./model";

describe("volumes model", () => {
  it("converts pixels and native coordinates through the north-up affine", () => {
    const gt = exampleSurface.geotransform!;
    expect(pixelToNative(gt, 100, 200)).toEqual([500010, 3299980]);
    const [px, py] = nativeToPixel(gt, 500010, 3299980);
    expect(px).toBeCloseTo(100, 9);
    expect(py).toBeCloseTo(200, 9);
  });

  it("labels fill and cut by base kind", () => {
    expect(labels("toe_plane")).toEqual({
      fill: "Stockpile volume (above base)",
      cut: "Below base",
      headline: "fill",
    });
    expect(labels("surface", { kind: "cloud_dsm", captured_on: "2026-03-01" }).fill).toBe(
      "Added since 2026-03-01 (fill)",
    );
    expect(labels("surface", { kind: "design", captured_on: null })).toEqual({
      fill: "Above design (to cut)",
      cut: "Below design (to fill)",
      headline: "both",
    });
  });

  it("writes the ± and says when it is incomplete", () => {
    const u = exampleMeasurement.results!.uncertainty;
    expect(uncertaintyText(u)).toBe("± 14.2 m³ (indicative)");
    expect(uncertaintyText({ ...u, complete: false })).toBe("± 14.2 m³ (indicative, incomplete)");
    expect(uncertaintyText({ ...u, total_m3: null, complete: false })).toBe(
      "± unknown (indicative, incomplete)",
    );
    expect(formatM3(12345.67)).toBe("12 345.7 m³");
  });

  it("names why a measurement went stale", () => {
    expect(staleText(["base changed", "masks: detection run deleted"])).toBe(
      "Inputs changed: base changed, masks: detection run deleted — Recalculate",
    );
    expect(staleText([])).toBe("Inputs changed — Recalculate");
  });

  it("groups runs by flight and drops unfinished ones", () => {
    const running = { ...exampleMapRun, id: "running", state: "running" as const };
    const groups = groupRuns([exampleMapRun, otherFlightRun, running], exampleMapRun.map_id, null);
    expect(groups.map((g) => [g.title, g.runs.map((r) => r.id)])).toEqual([
      ["Same flight as top", [exampleMapRun.id]],
      ["Other maps", [otherFlightRun.id]],
    ]);
  });

  it("sends only the build settings that differ from the defaults", () => {
    const form = buildDefaults({ id: "c1", name: "Chimney" });
    expect(form.name).toBe("Chimney surface");
    expect(buildRequest(form)).toEqual({ point_cloud_id: "c1", name: "Chimney surface", method: "median" });
    expect(buildRequest({ ...form, cell: 0.1, despikeOn: false, assumeMetres: true })).toEqual({
      point_cloud_id: "c1",
      name: "Chimney surface",
      method: "median",
      cell_size_m: 0.1,
      despike_m: null,
      assume_metres: true,
    });
  });

  it("disables export for stale and failed measurements, with the reason", () => {
    expect(exportState(exampleMeasurement)).toEqual({ enabled: true, reason: null });
    expect(exportState({ ...exampleMeasurement, status: "stale" }).reason).toMatch(/recalculate/);
    expect(exportState({ ...exampleMeasurement, status: "failed", error: "edge too short" }).reason).toBe(
      "edge too short",
    );
  });

  it("picks the worst warning tone and the next free name", () => {
    expect(worstTone([])).toBe("ok");
    expect(worstTone([{ code: "nodata_high", severity: "danger", message: "" }])).toBe("danger");
    expect(nextName([{ name: "Pile 1" }, { name: "Pile 2" }])).toBe("Pile 3");
    expect(headline(exampleMeasurement)).toBe("1 234.5 m³");
  });

  it("links the polygon to the cloud in the cloud's CRS", () => {
    const href = viewIn3dHref(PROJECT_ID, exampleSurface, exampleMeasurement.polygon_native)!;
    expect(href).toBe(
      `/p/${PROJECT_ID}/clouds/${exampleSurface.point_cloud_id}?at=500020.000,3299980.000` +
        "&fp=500010.000,3299970.000;500030.000,3299970.000;500030.000,3299990.000;500010.000,3299990.000",
    );
    expect(viewIn3dHref(PROJECT_ID, { ...exampleSurface, point_cloud_id: null }, [])).toBeNull();
    expect(viewIn3dHref(PROJECT_ID, { ...exampleSurface, kind: "design" }, [])).toBeNull();
  });
});
