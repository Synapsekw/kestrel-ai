import { beforeEach, describe, expect, it } from "vitest";
import {
  BUILD_JOB,
  drawingJob,
  INSPECT_JOB,
  pdfDrawing,
  pdfInspection,
  pngWorldFileInspection,
  bigPdfInspection,
} from "@/mapws/drawings/testFixtures";
import { drawingWait } from "@/setup/drawingSetup";
import { useJobsStore } from "@/store/jobs";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import type { DrawingInspection } from "@/api/drawings";
import { importDrawingFile } from "./importFile";

beforeEach(() => {
  drawingWait.sleep = async () => {};
  useJobsStore.setState({ jobs: {} });
});

function serve(insp: DrawingInspection) {
  return fakeClient([
    {
      method: "POST",
      path: /\/drawing-inspections$/,
      status: 202,
      body: { inspection: { ...insp, state: "inspecting" }, job: drawingJob(INSPECT_JOB, "running") },
    },
    { method: "GET", path: /\/drawing-inspections\/[^/]+$/, body: insp },
    {
      method: "POST",
      path: /\/drawings\/pages$/,
      status: 202,
      body: {
        drawings: [
          { ...pdfDrawing, id: "p1", page: 1 },
          { ...pdfDrawing, id: "p2", page: 2 },
        ],
        job: drawingJob(BUILD_JOB, "queued"),
      },
    },
    {
      method: "POST",
      path: /\/drawings$/,
      status: 202,
      body: { drawing: pdfDrawing, job: drawingJob(BUILD_JOB, "queued") },
    },
  ]);
}

describe("importDrawingFile", () => {
  it("imports every page of a multi-page PDF", async () => {
    const { api, requests } = serve(pdfInspection);
    const out = await importDrawingFile(api, PROJECT_ID, pdfInspection.path);
    expect(out.drawings.map((d) => d.id)).toEqual(["p1", "p2"]);
    expect(out.job.id).toBe(BUILD_JOB);
    expect(requests.at(-1)?.body).toMatchObject({ pages: "all", name: "foundation-plan" });
  });

  it("imports a one-page PDF as one drawing", async () => {
    const { api, requests } = serve(bigPdfInspection);
    const out = await importDrawingFile(api, PROJECT_ID, bigPdfInspection.path);
    expect(out.drawings).toEqual([pdfDrawing]);
    expect(requests.at(-1)?.body).toMatchObject({ page: 1 });
  });

  it("throws the reason when the file needs a choice", async () => {
    const { api } = serve(pngWorldFileInspection);
    await expect(importDrawingFile(api, PROJECT_ID, pngWorldFileInspection.path)).rejects.toThrow(
      /A world file has no CRS/,
    );
  });
});
