import { describe, expect, it } from "vitest";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { LOCAL, UTM33 } from "@/mapws/test/fixtures";
import {
  createDrawing,
  createDrawingInspection,
  frameKey,
  pageThumbUrl,
  putDrawingGeoref,
  rasterTileTemplate,
  vectorTileTemplate,
} from "./drawings";
import { importElevation } from "./elevations";

const BASE = "http://127.0.0.1:8765/";
const q = (url: string) => new URL(url.replace("{z}/{x}/{y}", "0/0/0")).searchParams;

describe("drawing URLs", () => {
  it("builds the page thumbnail URL with the token", () => {
    expect(pageThumbUrl(BASE, "t k", "p1", "i1", 3)).toBe(
      "http://127.0.0.1:8765/api/v1/projects/p1/drawing-inspections/i1/pages/3/thumbnail?token=t+k",
    );
  });

  it("versions the vector tiles and keys them by frame", () => {
    const url = vectorTileTemplate(BASE, "t", "p1", "d1", {
      v: "4",
      frame: "EPSG:32638",
    });
    expect(url.startsWith("http://127.0.0.1:8765/api/v1/projects/p1/drawings/d1/vtiles/{z}/{x}/{y}?")).toBe(
      true,
    );
    expect(q(url).get("v")).toBe("4");
    expect(q(url).get("frame_key")).toBe("EPSG:32638");
    expect(q(url).get("token")).toBe("t");
    expect(q(url).has("t")).toBe(false);
  });

  it("puts the preview transform and knockout on raster site tiles", () => {
    const url = rasterTileTemplate(BASE, "t", "p1", "d1", {
      v: "2",
      frame: "kestrel-local",
      preview: [0.5, 0, 100, 0, 0.5, -20.25],
      knockout: true,
    });
    expect(
      url.startsWith("http://127.0.0.1:8765/api/v1/projects/p1/site-tiles/drawing_raster/d1/{z}/{x}/{y}?"),
    ).toBe(true);
    expect(q(url).get("t")).toBe("0.5,0,100,0,0.5,-20.25");
    expect(q(url).get("knockout")).toBe("true");
    expect(q(url).get("frame_key")).toBe("kestrel-local");
  });

  it("names the frame by its site tile key (siteCode; W2-12/PF3)", () => {
    expect(frameKey(UTM33)).toBe("EPSG:32633");
    expect(frameKey(LOCAL)).toBe("kestrel-local");
  });
});

describe("drawing requests", () => {
  it("posts the inspection path, the build body, the georef and the elevation", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/drawing-inspections$/,
        status: 202,
        body: { inspection: {}, job: {} },
      },
      {
        method: "POST",
        path: /\/drawings$/,
        status: 202,
        body: { drawing: {}, job: {} },
      },
      { method: "PUT", path: /\/drawings\/d1\/georef$/, body: {} },
      {
        method: "POST",
        path: /\/elevations$/,
        status: 202,
        body: { surface: {}, job: {} },
      },
    ]);
    await createDrawingInspection(api, PROJECT_ID, "D:\\plans\\a.pdf");
    await createDrawing(api, PROJECT_ID, {
      inspection_id: "i1",
      name: "a",
      page: 1,
      dpi: 150,
      placement: { method: "none" },
    });
    await putDrawingGeoref(api, PROJECT_ID, "d1", {
      model: "similarity",
      points: [{ id: "cp1", src: [0, 0], dst: [1, 2] }],
      dst_frame: "site",
    });
    await importElevation(api, PROJECT_ID, {
      path: "D:\\dsm.tif",
      name: "dsm",
      role: "dsm",
    });
    // Preflight adaptation #1: RecordedRequest.url is a path + query string, not an absolute URL
    // (fe/test/fixtures.ts:441-444), so `new URL(r.url)` would throw.
    expect(requests.map((r) => `${r.method} ${r.url.split("?")[0]}`)).toEqual([
      `POST /api/v1/projects/${PROJECT_ID}/drawing-inspections`,
      `POST /api/v1/projects/${PROJECT_ID}/drawings`,
      `PUT /api/v1/projects/${PROJECT_ID}/drawings/d1/georef`,
      `POST /api/v1/projects/${PROJECT_ID}/elevations`,
    ]);
    expect(requests[0].body).toEqual({ path: "D:\\plans\\a.pdf" });
    expect(requests[2].body).toMatchObject({
      model: "similarity",
      dst_frame: "site",
    });
  });
});
