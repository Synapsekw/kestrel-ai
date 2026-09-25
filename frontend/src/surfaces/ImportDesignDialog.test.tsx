import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import type { FakeRoute } from "@/test/fixtures";
import { ImportDesignDialog } from "./ImportDesignDialog";
import {
  BUILD_JOB,
  blockedPreview,
  designSurface,
  exampleTarget,
  INSPECT_JOB,
  INSPECTION_ID,
  landxmlInspection,
  PREVIEW_JOB,
  readyPreview,
  warnPreview,
} from "./testFixtures";

const job = (id: string, state: string) => ({
  id,
  project_id: PROJECT_ID,
  type: "design_import",
  state,
  progress: state === "succeeded" ? 1 : 0.3,
  message: "Reading design file",
  log_path: "",
  params: {},
  result: null,
  error: null,
  created_at: "2026-09-24T09:00:00Z",
  started_at: null,
  finished_at: null,
});

function routes(preview = readyPreview, extra: FakeRoute[] = []): FakeRoute[] {
  return [
    ...extra,
    { method: "GET", path: /\/surfaces$/, body: { items: [exampleTarget] } },
    {
      method: "POST",
      path: /\/design-inspections$/,
      status: 202,
      body: {
        inspection: { ...landxmlInspection, state: "inspecting", candidates: [], detected: null },
        job: job(INSPECT_JOB, "queued"),
      },
    },
    { method: "GET", path: new RegExp(`/jobs/${INSPECT_JOB}$`), body: job(INSPECT_JOB, "succeeded") },
    { method: "GET", path: new RegExp(`/design-inspections/${INSPECTION_ID}$`), body: landxmlInspection },
    {
      method: "POST",
      path: /\/previews$/,
      status: 202,
      body: { preview: { ...preview, state: "running" }, job: job(PREVIEW_JOB, "queued") },
    },
    { method: "GET", path: new RegExp(`/jobs/${PREVIEW_JOB}$`), body: job(PREVIEW_JOB, "succeeded") },
    { method: "GET", path: /\/previews\/[^/]+$/, body: preview },
    {
      method: "POST",
      path: /\/design-surfaces$/,
      status: 202,
      body: { surface: designSurface, job: job(BUILD_JOB, "queued") },
    },
    { method: "DELETE", path: /\/design-inspections\/[^/]+$/, status: 204 },
  ];
}

async function readFile() {
  fireEvent.change(screen.getByLabelText("Design file"), { target: { value: "D:\\designs\\site-tin.xml" } });
  fireEvent.click(screen.getByRole("button", { name: "Read file" }));
  await screen.findByRole("combobox", { name: "Surface" });
}

async function preview() {
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  await screen.findByRole("img", { name: "The design over the cloud surface" });
}

describe("ImportDesignDialog", () => {
  it("reads a LandXML file and prefills the placement", async () => {
    const { api, requests } = fakeClient(routes());
    renderWithProviders(
      <ImportDesignDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    await readFile();
    expect(requests.find((r) => r.method === "POST")?.body).toEqual({ path: "D:\\designs\\site-tin.xml" });
    expect(screen.getByRole("combobox", { name: "Surface" })).toHaveValue("c0");
    expect(screen.getByRole("option", { name: /Grid 1m/ })).toBeDisabled();
    expect(screen.getByLabelText("Source CRS")).toHaveValue("EPSG:32639");
    expect(screen.getByText("From the file: LandXML <CoordinateSystem epsgCode>")).toBeInTheDocument();
    expect(screen.getByText("LandXML stores northing first — already handled")).toBeInTheDocument();
    expect(screen.getAllByRole("option", { name: "US survey foot (1200/3937 m)" })).toHaveLength(2);
    expect(screen.queryByLabelText("Cell size (m)")).not.toBeInTheDocument(); // a target is chosen
  });

  it("shows the DWG answer inline under the file", async () => {
    const dwg = {
      method: "POST",
      path: /\/design-inspections$/,
      status: 422,
      body: {
        error: {
          code: "validation_error",
          message:
            "DWG files can't be read. Open the drawing in your CAD program (or the free ODA File Converter) and save it as DXF, then import the DXF.",
          details: { reason: "dwg" },
        },
      },
    };
    const { api } = fakeClient([dwg]);
    renderWithProviders(
      <ImportDesignDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    fireEvent.change(screen.getByLabelText("Design file"), { target: { value: "D:\\site.dwg" } });
    fireEvent.click(screen.getByRole("button", { name: "Read file" }));
    expect(await screen.findByText(/save it as DXF/)).toBeInTheDocument();
  });

  it("previews, marks the preview stale on change, and imports", async () => {
    const onStarted = vi.fn();
    const { api, requests } = fakeClient(routes());
    renderWithProviders(
      <ImportDesignDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={onStarted} />,
      { api },
    );
    await readFile();
    await preview();
    expect(screen.getByText("97.3 %")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Swap easting and northing" }));
    expect(screen.getByText("Preview out of date")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import surface" })).toBeDisabled();
    fireEvent.click(screen.getByRole("switch", { name: "Swap easting and northing" }));
    fireEvent.click(screen.getByRole("button", { name: "Import surface" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(designSurface));
    const post = requests.find((r) => r.url.endsWith("/design-surfaces"));
    expect(post?.body).toEqual({
      inspection_id: INSPECTION_ID,
      preview_id: readyPreview.id,
      accept_warnings: false,
      name: "site-tin — Existing ground",
    });
    expect(useJobsStore.getState().jobs[BUILD_JOB]?.type).toBe("design_import");
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
  });

  it("needs the checkbox on warnings and applies a suggestion with a new preview", async () => {
    const { api, requests } = fakeClient(routes(warnPreview));
    renderWithProviders(
      <ImportDesignDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    await readFile();
    await preview();
    expect(screen.getByRole("button", { name: "Import surface" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Import despite these warnings" }));
    expect(screen.getByRole("button", { name: "Import surface" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(requests.filter((r) => r.url.endsWith("/previews"))).toHaveLength(2));
    const second = requests.filter((r) => r.url.endsWith("/previews"))[1];
    expect((second.body as { swap_xy: boolean }).swap_xy).toBe(true);
  });

  it("refuses to import a blocked preview and says why", async () => {
    const { api } = fakeClient(routes(blockedPreview));
    renderWithProviders(
      <ImportDesignDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    await readFile();
    await preview();
    expect(screen.getByRole("button", { name: "Import surface" })).toBeDisabled();
    expect(
      screen.getByText("This design can't be imported: the selection mixes 3D faces and lines"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Import despite these warnings" })).not.toBeInTheDocument();
  });

  it("deletes the inspection when closed before importing", async () => {
    const onClose = vi.fn();
    const { api, requests } = fakeClient(routes());
    renderWithProviders(
      <ImportDesignDialog projectId={PROJECT_ID} onClose={onClose} onStarted={() => {}} />,
      { api },
    );
    await readFile();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(requests.some((r) => r.method === "DELETE")).toBe(true));
  });
});
