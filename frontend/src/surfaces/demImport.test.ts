import { describe, expect, it } from "vitest";
import type { Surface } from "@contract/client";
import { cloudDsm, demSurface } from "@/mapws/drawings/testFixtures";
import { exampleTarget } from "./testFixtures";
import { alignTargets, fileStem, initialDemForm, toElevationRequest } from "./demImport";

describe("alignTargets", () => {
  it("keeps ready cloud DSMs and dems, newest survey first", () => {
    const design = { ...exampleTarget, id: "d", kind: "design" } as Surface;
    const building = { ...demSurface, id: "b", status: "building" } as Surface;
    expect(alignTargets([cloudDsm, design, building, demSurface]).map((s) => s.id)).toEqual([
      demSurface.id,
      cloudDsm.id,
    ]);
  });
});

describe("toElevationRequest", () => {
  const targets = [demSurface, cloudDsm];

  it("names the surface after the file and aligns to the newest DSM", () => {
    expect(toElevationRequest({ ...initialDemForm(), path: "D:\\surveys\\sep-dsm.tif" }, targets)).toEqual({
      ok: true,
      body: {
        path: "D:\\surveys\\sep-dsm.tif",
        name: "sep-dsm",
        role: "dsm",
        align_to_surface_id: demSurface.id,
      },
    });
  });

  it("sends a DTM with its date and a cell size on its own grid", () => {
    const f = {
      ...initialDemForm(),
      path: "D:\\dtm.TIFF",
      role: "dtm" as const,
      capturedOn: "2026-09-14",
      alignTo: "",
      cellSize: "0.25",
    };
    expect(toElevationRequest(f, targets)).toEqual({
      ok: true,
      body: {
        path: "D:\\dtm.TIFF",
        name: "dtm",
        role: "dtm",
        captured_on: "2026-09-14",
        cell_size_m: 0.25,
      },
    });
  });

  it.each([
    [{ path: "" }, "path", "Choose the GeoTIFF to import."],
    [{ path: "D:\\ortho.jpg" }, "path", "Pick a .tif or .tiff file."],
    [{ path: "D:\\a.tif", name: "  " }, "name", "Give the surface a name."],
    [{ path: "D:\\a.tif", name: "x".repeat(201) }, "name", "Keep the name under 200 characters."],
    [{ path: "D:\\a.tif", capturedOn: "14/09/2026" }, "capturedOn", "Use a date like 2026-09-14."],
    [
      { path: "D:\\a.tif", alignTo: "", cellSize: "-1" },
      "cellSize",
      "The cell size is between 0.01 and 5 m.",
    ],
    [
      { path: "D:\\a.tif", alignTo: "", cellSize: "12" },
      "cellSize",
      "The cell size is between 0.01 and 5 m.",
    ],
  ])("refuses %o", (patch, field, error) => {
    expect(toElevationRequest({ ...initialDemForm(), ...patch }, targets)).toEqual({
      ok: false,
      field,
      error,
    });
  });

  it("takes the stem of a path without an extension", () => {
    expect(fileStem("C:/x/y/dsm")).toBe("dsm");
  });

  it("caps the default name (stem) at 200 characters", () => {
    const longPath = `D:\\surveys\\${"a".repeat(250)}.tif`;
    expect(fileStem(longPath)).toHaveLength(200);
  });
});
