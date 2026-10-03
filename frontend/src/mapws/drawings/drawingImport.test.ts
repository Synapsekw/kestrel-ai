import { describe, expect, it } from "vitest";
import {
  defaultDrawingName,
  epsgFromHint,
  familyOf,
  fitDpi,
  initialDrawingForm,
  placementChoices,
  renderSize,
  toDrawingRequest,
  toDrawingPagesRequest,
  autoImportRequest,
} from "./drawingImport";
import type { DrawingInspection } from "@/api/drawings";
import { bigPdfInspection, dxfInspection, pdfInspection, pngWorldFileInspection } from "./testFixtures";

describe("families", () => {
  it.each([
    ["dxf", "vector"],
    ["landxml", "vector"],
    ["pdf", "pdf"],
    ["png", "raster"],
    ["jpg", "raster"],
    ["tif", "raster"],
  ] as const)("%s is %s", (f, fam) => expect(familyOf(f)).toBe(fam));
});

describe("fitDpi (spec §8.2: ≤ 20 000 px a side, ≤ 300 MP; the contract takes 100/150/200/300)", () => {
  it("keeps the chosen DPI when the page fits", () => {
    expect(fitDpi({ width_pt: 2384, height_pt: 1684 }, 300)).toEqual({
      dpi: 300,
      renderDpi: 300,
      lowered: false,
    });
  });
  it("lowers to the next allowed DPI by the longest side", () => {
    expect(fitDpi({ width_pt: 7200, height_pt: 4320 }, 300)).toEqual({
      dpi: 200,
      renderDpi: 200,
      lowered: true,
    });
    expect(renderSize({ width_pt: 7200, height_pt: 4320 }, 200)).toEqual({
      width: 20000,
      height: 12000,
    });
  });
  it("lowers by the pixel count", () => {
    expect(fitDpi({ width_pt: 5184, height_pt: 5184 }, 300)).toEqual({
      dpi: 200,
      renderDpi: 200,
      lowered: true,
    });
  });
  it("sends 100 for a page too big even at 100 and reports the render DPI the server will use", () => {
    expect(fitDpi({ width_pt: 20000, height_pt: 14400 }, 150)).toEqual({
      dpi: 100,
      renderDpi: 72,
      lowered: true,
    });
  });
});

describe("initialDrawingForm and placement", () => {
  it("a PDF is placed with control points only", () => {
    expect(initialDrawingForm(pdfInspection)).toMatchObject({
      page: 1,
      dpi: 150,
      placement: "none",
    });
    expect(placementChoices(pdfInspection).map((c) => c.value)).toEqual(["none"]);
  });
  it("a world file offers embedded placement and asks for its CRS", () => {
    expect(initialDrawingForm(pngWorldFileInspection)).toMatchObject({
      placement: "embedded",
      epsg: "",
    });
    expect(placementChoices(pngWorldFileInspection).map((c) => c.label)).toEqual([
      "World file",
      "Place with control points",
    ]);
  });
  it("a DXF prefills the EPSG found in its CRS hint, its units and its non-empty default layers", () => {
    expect(epsgFromHint("WGS 84 / UTM zone 38N (EPSG:32638)")).toBe(32638);
    expect(epsgFromHint("Local site grid")).toBeNull();
    expect(initialDrawingForm(dxfInspection)).toMatchObject({
      placement: "crs",
      epsg: "32638",
      units: "millimetre",
      layers: ["WALLS", "TEXT"],
    });
  });
});

describe("toDrawingRequest", () => {
  it("names a multi-page PDF after its page and sends an allowed DPI", () => {
    expect(
      toDrawingRequest(bigPdfInspection, {
        ...initialDrawingForm(bigPdfInspection),
        dpi: 300,
      }),
    ).toEqual({
      ok: true,
      body: {
        inspection_id: bigPdfInspection.id,
        name: "site-poster",
        page: 1,
        dpi: 200,
        placement: { method: "none" },
      },
    });
    expect(defaultDrawingName(pdfInspection, 2)).toBe("foundation-plan · p2");
  });

  it("requires the EPSG of a world file", () => {
    const f = initialDrawingForm(pngWorldFileInspection);
    expect(toDrawingRequest(pngWorldFileInspection, f)).toEqual({
      ok: false,
      error: "A world file has no CRS: enter the EPSG code of its coordinates, such as 32638.",
    });
    expect(toDrawingRequest(pngWorldFileInspection, { ...f, epsg: "32638" })).toMatchObject({
      ok: true,
      body: { placement: { method: "embedded", crs: "EPSG:32638" } },
    });
  });

  it("sends a DXF's layers, units and CRS; refuses no layers and a bad EPSG", () => {
    const f = initialDrawingForm(dxfInspection);
    expect(toDrawingRequest(dxfInspection, f)).toEqual({
      ok: true,
      body: {
        inspection_id: dxfInspection.id,
        name: "site-plan",
        layers: ["WALLS", "TEXT"],
        placement: { method: "crs", crs: "EPSG:32638", units: "millimetre" },
      },
    });
    expect(toDrawingRequest(dxfInspection, { ...f, layers: [] })).toEqual({
      ok: false,
      error: "Choose at least one layer to import.",
    });
    expect(toDrawingRequest(dxfInspection, { ...f, epsg: "38N" })).toEqual({
      ok: false,
      error: "Enter an EPSG code such as 32638.",
    });
  });

  it("refuses an empty name and a page out of range", () => {
    expect(
      toDrawingRequest(pdfInspection, {
        ...initialDrawingForm(pdfInspection),
        name: " ",
      }),
    ).toEqual({
      ok: false,
      error: "Give the drawing a name.",
    });
    expect(
      toDrawingRequest(pdfInspection, {
        ...initialDrawingForm(pdfInspection),
        page: 9,
      }),
    ).toEqual({
      ok: false,
      error: "Choose a page between 1 and 2.",
    });
  });

  it("keeps the page suffix when it caps a long multi-page default name", () => {
    const insp = { ...pdfInspection, path: `D:/plans/${"x".repeat(250)}.pdf` };
    const name = defaultDrawingName(insp, 12);
    expect(name).toHaveLength(200);
    expect(name.endsWith(" · p12")).toBe(true);
  });

  it("caps a long default name and refuses a longer user-given one (PF12a)", () => {
    const longStem = "x".repeat(250);
    const insp = {
      ...pdfInspection,
      path: `D:\\plans\\${longStem}.pdf`,
      page_count: 1,
      pages: [{ page: 1, width_pt: 2384, height_pt: 1684 }],
    };
    expect(defaultDrawingName(insp, 1).length).toBe(200);
    const f = initialDrawingForm(insp);
    expect(toDrawingRequest(insp, { ...f, name: "y".repeat(201) })).toEqual({
      ok: false,
      error: "Keep the name under 200 characters.",
    });
  });
});

const threePages: DrawingInspection = {
  ...pdfInspection,
  page_count: 3,
  pages: [...pdfInspection.pages, { page: 3, width_pt: 2384, height_pt: 1684 }],
};

describe("toDrawingPagesRequest (plant-model spec §8.1: all pages, one job)", () => {
  it("selects every page of a multi-page PDF by default and sends 'all'", () => {
    const f = initialDrawingForm(threePages);
    expect(f.pages).toEqual([1, 2, 3]);
    expect(toDrawingPagesRequest(threePages, f)).toEqual({
      ok: true,
      body: {
        inspection_id: threePages.id,
        name: "foundation-plan",
        pages: "all",
        dpi: 150,
        placement: { method: "none" },
      },
    });
  });

  it("sends the chosen pages in order and a custom name without its page suffix", () => {
    expect(
      toDrawingPagesRequest(threePages, {
        ...initialDrawingForm(threePages),
        pages: [3, 1, 3],
        name: " Plot plan · p3 ",
      }),
    ).toMatchObject({ ok: true, body: { name: "Plot plan", pages: [1, 3] } });
  });

  it("refuses no pages, a page out of range and an empty name", () => {
    const f = initialDrawingForm(threePages);
    expect(toDrawingPagesRequest(threePages, { ...f, pages: [] })).toEqual({
      ok: false,
      error: "Choose at least one page.",
    });
    expect(toDrawingPagesRequest(threePages, { ...f, pages: [1, 4] })).toEqual({
      ok: false,
      error: "Choose a page between 1 and 3.",
    });
    expect(toDrawingPagesRequest(threePages, { ...f, name: "  " })).toEqual({
      ok: false,
      error: "Give the drawing a name.",
    });
  });
});

describe("autoImportRequest (setup and Import and include)", () => {
  it("imports every page of a multi-page PDF", () => {
    expect(autoImportRequest(pdfInspection)).toMatchObject({ kind: "pages", body: { pages: "all" } });
  });
  it("imports a one-page PDF and a DXF as one drawing", () => {
    expect(autoImportRequest(bigPdfInspection)).toMatchObject({ kind: "one", body: { page: 1 } });
    expect(autoImportRequest(dxfInspection)).toMatchObject({
      kind: "one",
      body: { layers: ["WALLS", "TEXT"] },
    });
  });
  it("names what the operator must choose", () => {
    expect(autoImportRequest(pngWorldFileInspection)).toMatchObject({
      kind: "error",
      error: expect.stringContaining("A world file has no CRS"),
    });
  });
});
