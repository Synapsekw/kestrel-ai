import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { fakeClient, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import type { DrawingInspection } from "@/api/drawings";
import { ImportDrawingDialog } from "./ImportDrawingDialog";
import { setImportPrefill } from "./importPrefill";
import {
  BUILD_JOB,
  bigPdfInspection,
  drawingJob,
  dxfInspection,
  INSPECT_JOB,
  INSPECTION_ID,
  pdfDrawing,
  pdfInspection,
  pngWorldFileInspection,
} from "./testFixtures";

function routes(inspection: DrawingInspection, extra: FakeRoute[] = []): FakeRoute[] {
  return [
    ...extra,
    {
      method: "POST",
      path: /\/drawing-inspections$/,
      status: 202,
      body: {
        inspection: {
          ...inspection,
          state: "inspecting",
          pages: [],
          layers: [],
        },
        job: drawingJob(INSPECT_JOB, "queued"),
      },
    },
    {
      method: "GET",
      path: new RegExp(`/jobs/${INSPECT_JOB}$`),
      body: drawingJob(INSPECT_JOB, "succeeded"),
    },
    {
      method: "GET",
      path: new RegExp(`/drawing-inspections/${INSPECTION_ID}$`),
      body: inspection,
    },
    {
      method: "POST",
      path: /\/drawings$/,
      status: 202,
      body: { drawing: pdfDrawing, job: drawingJob(BUILD_JOB, "queued") },
    },
  ];
}

const posts = <T extends { method: string }>(requests: T[]) => requests.filter((r) => r.method === "POST");

async function read(path: string) {
  fireEvent.change(screen.getByLabelText("Drawing file"), {
    target: { value: path },
  });
  fireEvent.click(screen.getByRole("button", { name: "Read file" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Start import" })).toBeEnabled());
}

describe("ImportDrawingDialog", () => {
  beforeEach(() => setImportPrefill(null));

  it("inspects a PDF, picks page 2 at 300 dpi and queues the build", async () => {
    const onStarted = vi.fn();
    const { api, requests } = fakeClient(routes(pdfInspection));
    renderWithProviders(
      <ImportDrawingDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={onStarted} />,
      { api },
    );
    await read("D:\\plans\\foundation-plan.pdf");
    expect(posts(requests)[0]).toMatchObject({
      body: { path: "D:\\plans\\foundation-plan.pdf" },
    });
    const page2 = screen.getByRole("radio", { name: "Page 2" });
    expect(page2.querySelector("img")?.getAttribute("src")).toContain(
      `/drawing-inspections/${INSPECTION_ID}/pages/2/thumbnail?token=t`,
    );
    fireEvent.click(page2);
    fireEvent.click(screen.getByRole("radio", { name: "300 dpi" }));
    expect(screen.getByLabelText("Name")).toHaveValue("foundation-plan · p2");
    expect(screen.getByText(/placed with control points once it is imported/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start import" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(pdfDrawing));
    expect(posts(requests).at(-1)?.body).toEqual({
      inspection_id: INSPECTION_ID,
      name: "foundation-plan · p2",
      page: 2,
      dpi: 300,
      placement: { method: "none" },
    });
  });

  it("lowers the DPI of a large page and says so", async () => {
    const { api, requests } = fakeClient(routes(bigPdfInspection));
    renderWithProviders(
      <ImportDrawingDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    await read("D:\\plans\\site-poster.pdf");
    fireEvent.click(screen.getByRole("radio", { name: "300 dpi" }));
    expect(screen.getByText(/renders at 200 dpi to stay under 20 000 px/)).toBeInTheDocument();
    expect(screen.getByText("20000 × 12000 px")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start import" }));
    await waitFor(() => expect(posts(requests)).toHaveLength(2));
    expect(posts(requests).at(-1)?.body).toMatchObject({ dpi: 200 });
  });

  it("asks a world-file PNG for its EPSG before placing it, and shows the inspection's warning", async () => {
    const { api, requests } = fakeClient(routes(pngWorldFileInspection));
    renderWithProviders(
      <ImportDrawingDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    await read("D:\\plans\\scan.png");
    expect(screen.getByText("4000 × 3000 px")).toBeInTheDocument();
    expect(screen.getByText("The world file has no CRS: enter its EPSG code.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "World file" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Start import" }));
    expect(
      await screen.findByText(/A world file has no CRS: enter the EPSG code of its coordinates/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("EPSG code"), {
      target: { value: "32638" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start import" }));
    await waitFor(() => expect(posts(requests)).toHaveLength(2));
    expect(posts(requests).at(-1)?.body).toMatchObject({
      placement: { method: "embedded", crs: "EPSG:32638" },
    });
  });

  it("shows a failed inspection (an encrypted PDF) and keeps Start disabled", async () => {
    const failed = {
      ...pdfInspection,
      state: "failed" as const,
      error: "This PDF is password-protected. Save an unprotected copy and import that.",
    };
    const { api } = fakeClient(routes(failed));
    renderWithProviders(
      <ImportDrawingDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    fireEvent.change(screen.getByLabelText("Drawing file"), {
      target: { value: "D:\\locked.pdf" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Read file" }));
    expect(await screen.findByText(/password-protected/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start import" })).toBeDisabled();
  });

  it("shows the DWG refusal under the file", async () => {
    const dwg: FakeRoute = {
      method: "POST",
      path: /\/drawing-inspections$/,
      status: 422,
      body: {
        error: {
          code: "validation_error",
          message:
            "DWG files can't be read. Save the drawing as DXF in your CAD program, then import the DXF.",
          details: { reason: "dwg" },
        },
      },
    };
    const { api } = fakeClient([dwg]);
    renderWithProviders(
      <ImportDrawingDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    fireEvent.change(screen.getByLabelText("Drawing file"), {
      target: { value: "D:\\site.dwg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Read file" }));
    expect(await screen.findByText(/DWG files can't be read/)).toBeInTheDocument();
  });

  it("imports a DXF: its layers (empty ones unavailable), units and hinted CRS", async () => {
    const { api, requests } = fakeClient(routes(dxfInspection));
    renderWithProviders(
      <ImportDrawingDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    await read("D:\\plans\\site-plan.dxf");
    expect(screen.getByRole("checkbox", { name: /WALLS/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /DEFPOINTS/ })).toBeDisabled();
    expect(screen.getByLabelText("EPSG code")).toHaveValue("32638");
    expect(
      screen.getByText(/File says WGS 84 \/ UTM zone 38N \(EPSG:32638\) · unverified/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Drawing units")).toHaveValue("millimetre");
    fireEvent.click(screen.getByRole("checkbox", { name: /TEXT/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start import" }));
    await waitFor(() => expect(posts(requests)).toHaveLength(2));
    expect(posts(requests).at(-1)?.body).toEqual({
      inspection_id: INSPECTION_ID,
      name: "site-plan",
      layers: ["WALLS"],
      placement: { method: "crs", crs: "EPSG:32638", units: "millimetre" },
    });
  });

  it("refuses a DXF with no layer chosen", async () => {
    const { api } = fakeClient(routes(dxfInspection));
    renderWithProviders(
      <ImportDrawingDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    await read("D:\\plans\\site-plan.dxf");
    fireEvent.click(screen.getByRole("button", { name: "None" }));
    fireEvent.click(screen.getByRole("button", { name: "Start import" }));
    expect(await screen.findByText("Choose at least one layer to import.")).toBeInTheDocument();
  });

  it("starts from the Re-import path", () => {
    setImportPrefill("D:\\plans\\foundation-plan.pdf");
    const { api } = fakeClient([]);
    renderWithProviders(
      <ImportDrawingDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    expect(screen.getByLabelText("Drawing file")).toHaveValue("D:\\plans\\foundation-plan.pdf");
  });
});
