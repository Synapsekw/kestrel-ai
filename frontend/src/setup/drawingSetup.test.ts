import { beforeEach, describe, expect, it } from "vitest";
import type { DrawingInspection } from "@/api/drawings";
import {
  BUILD_JOB,
  DRAWING_ID,
  INSPECT_JOB,
  INSPECTION_ID,
  bigPdfInspection,
  drawingJob,
  dxfInspection,
  pdfInspection,
  pngWorldFileInspection,
} from "@/mapws/drawings/testFixtures";
import { useJobsStore } from "@/store/jobs";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { drawingWait, startDrawing } from "./drawingSetup";

const defaults = { ...drawingWait };

beforeEach(() => {
  Object.assign(drawingWait, defaults, { sleep: async () => {} });
  useJobsStore.setState({ jobs: {} });
});

/** The inspection reads `inspecting` for `inspectingReads` GETs, then `ready` as given. */
function serve(ready: DrawingInspection, inspectingReads = 1) {
  let reads = 0;
  return fakeClient([
    {
      method: "POST",
      path: /\/drawing-inspections$/,
      status: 202,
      body: { inspection: { ...ready, state: "inspecting" }, job: drawingJob(INSPECT_JOB, "running") },
    },
    {
      method: "GET",
      path: /\/drawing-inspections\/[^/]+$/,
      body: () => (++reads <= inspectingReads ? { ...ready, state: "inspecting" } : ready),
    },
    {
      method: "POST",
      path: /\/drawings$/,
      status: 202,
      body: { drawing: { id: DRAWING_ID }, job: drawingJob(BUILD_JOB, "queued") },
    },
  ]);
}

const short = (url: string) => url.replace(`/api/v1/projects/${PROJECT_ID}`, "");

describe("startDrawing", () => {
  it("reads a one-page PDF, then builds it with the Add data dialog's defaults", async () => {
    const { api, requests } = serve(bigPdfInspection, 2);
    await expect(startDrawing(api, PROJECT_ID, bigPdfInspection.path)).resolves.toEqual({
      state: "started",
      jobId: BUILD_JOB,
    });
    expect(requests.map((r) => `${r.method} ${short(r.url)}`)).toEqual([
      "POST /drawing-inspections",
      `GET /drawing-inspections/${INSPECTION_ID}`,
      `GET /drawing-inspections/${INSPECTION_ID}`,
      `GET /drawing-inspections/${INSPECTION_ID}`,
      "POST /drawings",
    ]);
    expect(requests[0].body).toEqual({ path: bigPdfInspection.path });
    expect(requests.at(-1)?.body).toEqual({
      inspection_id: INSPECTION_ID,
      name: "site-poster",
      placement: { method: "none" },
      page: 1,
      dpi: 150,
    });
    expect(Object.keys(useJobsStore.getState().jobs)).toEqual([INSPECT_JOB, BUILD_JOB]);
  });

  it("places a DXF by the EPSG code the file names, with its visible layers", async () => {
    const { api, requests } = serve(dxfInspection);
    await startDrawing(api, PROJECT_ID, dxfInspection.path);
    expect(requests.at(-1)?.body).toEqual({
      inspection_id: INSPECTION_ID,
      name: "site-plan",
      layers: ["WALLS", "TEXT"],
      placement: { method: "crs", crs: "EPSG:32638", units: "millimetre" },
    });
  });

  it("leaves a multi-page PDF to the operator and builds nothing", async () => {
    const { api, requests } = serve(pdfInspection);
    await expect(startDrawing(api, PROJECT_ID, pdfInspection.path)).resolves.toEqual({
      state: "needs_choice",
      error: "This PDF has 2 pages. Choose the page to import.",
    });
    expect(requests.some((r) => r.url.endsWith("/drawings"))).toBe(false);
  });

  it("leaves a world file without a coordinate system to the operator", async () => {
    const { api, requests } = serve(pngWorldFileInspection);
    const out = await startDrawing(api, PROJECT_ID, pngWorldFileInspection.path);
    expect(out).toMatchObject({
      state: "needs_choice",
      error: expect.stringContaining("A world file has no CRS"),
    });
    expect(requests.some((r) => r.url.endsWith("/drawings"))).toBe(false);
  });

  it("fails with the inspection's error when the file cannot be read", async () => {
    const { api } = serve({ ...bigPdfInspection, state: "failed", error: "the file is not a PDF" }, 0);
    await expect(startDrawing(api, PROJECT_ID, bigPdfInspection.path)).rejects.toThrow(
      "the file is not a PDF",
    );
  });

  it("stops waiting after drawingWait.maxMs and leaves the drawing to Add data", async () => {
    drawingWait.maxMs = 3_000;
    const { api, requests } = serve(bigPdfInspection, 99);
    await expect(startDrawing(api, PROJECT_ID, bigPdfInspection.path)).resolves.toEqual({
      state: "needs_choice",
      error: "The drawing is still being read. Finish its import from Add data.",
    });
    expect(requests.filter((r) => r.method === "GET")).toHaveLength(4);
  });
});
