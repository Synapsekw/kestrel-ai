import { describe, expect, it } from "vitest";
import {
  applyPatch,
  crsHint,
  defaultName,
  formKey,
  importGate,
  initialForm,
  isStale,
  pointsSelected,
  toRequest,
  UNIT_OPTIONS,
} from "./designImport";
import {
  blockedPreview,
  demInspection,
  dxfInspection,
  exampleTarget,
  landxmlInspection,
  readyPreview,
  TARGET_ID,
  warnPreview,
} from "./testFixtures";

describe("designImport", () => {
  it("prefills a LandXML import from the file and the default target", () => {
    const f = initialForm(landxmlInspection, [exampleTarget]);
    expect(f).toEqual({
      candidateIds: ["c0"],
      sourceCrs: "EPSG:32639",
      horizontalUnit: "metre",
      verticalUnit: "metre",
      swapXy: false,
      targetSurfaceId: TARGET_ID,
      cellSizeM: "0.25",
      maxEdgeM: "",
    });
    expect(crsHint(landxmlInspection, f, [exampleTarget])).toBe(
      "From the file: LandXML <CoordinateSystem epsgCode>",
    );
  });

  it("assumes the target's CRS when the file has none, and says so", () => {
    const f = initialForm(dxfInspection, [exampleTarget]);
    expect(f.sourceCrs).toBe("EPSG:32639");
    expect(f.horizontalUnit).toBe("");
    expect(crsHint(dxfInspection, f, [exampleTarget])).toBe(
      "Assumed from the cloud surface — confirm it. The file says: GEODATA: UTM84-39N",
    );
    expect(pointsSelected(dxfInspection, f)).toBe(true);
  });

  it("uses no target when the default is not among the ready surfaces", () => {
    expect(initialForm(landxmlInspection, []).targetSurfaceId).toBe("");
  });

  it("sends metre as the ignored horizontal unit of a DEM", () => {
    const f = initialForm(demInspection, [exampleTarget]);
    expect(f.horizontalUnit).toBe("metre");
    expect(f.sourceCrs).toBe("EPSG:32638");
  });

  it("maps the form to the request and validates it", () => {
    const f = initialForm(landxmlInspection, [exampleTarget]);
    expect(toRequest(f)).toEqual({
      ok: true,
      body: {
        candidate_ids: ["c0"],
        source_crs: "EPSG:32639",
        horizontal_unit: "metre",
        vertical_unit: "metre",
        swap_xy: false,
        target_surface_id: TARGET_ID,
      },
    });
    const noTarget = { ...f, targetSurfaceId: "", cellSizeM: "0.5", maxEdgeM: "12" };
    expect(toRequest(noTarget)).toMatchObject({
      ok: true,
      body: { target_surface_id: null, cell_size_m: 0.5, max_edge_m: 12 },
    });
    expect(toRequest({ ...noTarget, cellSizeM: "0" })).toEqual({
      ok: false,
      error: "Enter a cell size in metres.",
    });
    expect(toRequest({ ...f, horizontalUnit: "" })).toEqual({
      ok: false,
      error: "Choose the horizontal and height units.",
    });
    expect(toRequest({ ...f, candidateIds: [] })).toEqual({ ok: false, error: "Choose what to import." });
    expect(toRequest({ ...f, sourceCrs: " " })).toEqual({
      ok: false,
      error: "Enter the CRS the design was drawn in, for example EPSG:32639.",
    });
  });

  it("detects a stale preview after any option change", () => {
    const f = initialForm(landxmlInspection, [exampleTarget]);
    const key = formKey(f);
    expect(isStale(f, readyPreview, key)).toBe(false);
    expect(isStale({ ...f, swapXy: true }, readyPreview, key)).toBe(true);
    expect(isStale({ ...f, verticalUnit: "us_survey_foot" }, readyPreview, key)).toBe(true);
    expect(isStale(f, null, null)).toBe(false);
  });

  it("applies a suggestion patch", () => {
    const f = initialForm(landxmlInspection, [exampleTarget]);
    expect(applyPatch(f, { swap_xy: true }).swapXy).toBe(true);
    expect(applyPatch(f, { horizontal_unit: "international_foot" }).horizontalUnit).toBe(
      "international_foot",
    );
    expect(applyPatch(f, { nonsense: 1 })).toEqual(f);
  });

  it("gates the import on block and warn", () => {
    expect(importGate(null, false, false)).toMatchObject({
      allowed: false,
      reason: "Preview the design first.",
    });
    expect(importGate(readyPreview, false, false)).toEqual({
      allowed: true,
      needsAccept: false,
      reason: null,
    });
    expect(importGate(readyPreview, true, false).allowed).toBe(false);
    expect(importGate(blockedPreview, false, true)).toMatchObject({
      allowed: false,
      reason: "This design can't be imported: the selection mixes 3D faces and lines",
    });
    expect(importGate(warnPreview, false, false)).toMatchObject({ allowed: false, needsAccept: true });
    expect(importGate(warnPreview, false, true)).toEqual({ allowed: true, needsAccept: true, reason: null });
  });

  it("names the surface after the file and the candidates", () => {
    expect(defaultName(landxmlInspection, initialForm(landxmlInspection, []))).toBe(
      "site-tin — Existing ground",
    );
  });

  it("spells out both feet", () => {
    const labels = UNIT_OPTIONS.map((u) => u.label);
    expect(labels).toContain("US survey foot (1200/3937 m)");
    expect(labels).toContain("International foot (0.3048 m)");
  });
});
