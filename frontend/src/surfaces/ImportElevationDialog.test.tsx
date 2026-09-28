import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { ApiClient } from "@contract/client";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { cloudDsm, DEM_ID, demSurface, drawingJob } from "@/mapws/drawings/testFixtures";
import { ImportElevationDialog } from "./ImportElevationDialog";

vi.mock("./ImportDesignDialog", () => ({
  ImportDesignDialog: () => <div role="dialog" aria-label="Import design surface" />,
}));

describe("ImportElevationDialog", () => {
  it("opens the design-surface import", async () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <ImportElevationDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    fireEvent.click(screen.getByRole("button", { name: /Design surface/ }));
    expect(await screen.findByRole("dialog", { name: "Import design surface" })).toBeInTheDocument();
  });

  it("links a cloud-built DSM to the volume view", () => {
    const onClose = vi.fn();
    const { api } = fakeClient([]);
    renderWithProviders(
      <ImportElevationDialog projectId={PROJECT_ID} onClose={onClose} onStarted={() => {}} />,
      { api },
    );
    const link = screen.getByRole("link", { name: /Build from a point cloud/ });
    expect(link).toHaveAttribute("href", `/p/${PROJECT_ID}/measurements/volumes`);
    fireEvent.click(link);
    expect(onClose).toHaveBeenCalled();
  });
});

describe("ImportElevationDialog — DSM / DTM GeoTIFF (M §7)", () => {
  const routes = () => [
    {
      method: "GET",
      path: /\/surfaces$/,
      body: { items: [cloudDsm, demSurface] },
    },
    {
      method: "POST",
      path: /\/elevations$/,
      status: 202,
      body: {
        surface: { ...demSurface, status: "building" },
        job: drawingJob("j-dem", "queued", "elevation_import"),
      },
    },
  ];
  const open = (api: ApiClient, onStarted = vi.fn()) => {
    renderWithProviders(
      <ImportElevationDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={onStarted} />,
      { api },
    );
    fireEvent.click(screen.getByRole("button", { name: /DSM \/ DTM GeoTIFF/ }));
    return screen.findByRole("combobox", { name: "Align to" });
  };

  it("imports a DSM aligned to the newest DSM and records the queued job", async () => {
    const onStarted = vi.fn();
    const { api, requests } = fakeClient(routes());
    const align = await open(api, onStarted);
    await waitFor(() => expect(align).toHaveValue(DEM_ID));
    fireEvent.change(screen.getByLabelText("GeoTIFF file"), {
      target: { value: "D:\\surveys\\sep-dsm.tif" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start import" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(requests.find((r) => r.method === "POST")?.body).toEqual({
      path: "D:\\surveys\\sep-dsm.tif",
      name: "sep-dsm",
      role: "dsm",
      align_to_surface_id: DEM_ID,
    });
    expect(useJobsStore.getState().jobs["j-dem"]).toBeDefined();
  });

  it("imports a DTM on its own grid with a cell size and a date", async () => {
    const { api, requests } = fakeClient(routes());
    await open(api);
    fireEvent.change(screen.getByLabelText("GeoTIFF file"), {
      target: { value: "D:\\bare.tif" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "DTM — bare ground" }));
    fireEvent.change(screen.getByLabelText("Survey date"), {
      target: { value: "2026-09-14" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Align to" }), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Cell size (m)"), {
      target: { value: "0.1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start import" }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    expect(requests.find((r) => r.method === "POST")?.body).toEqual({
      path: "D:\\bare.tif",
      name: "bare",
      role: "dtm",
      captured_on: "2026-09-14",
      cell_size_m: 0.1,
    });
  });

  it("refuses a non-GeoTIFF before posting, and Back returns to the chooser", async () => {
    const { api, requests } = fakeClient(routes());
    await open(api);
    fireEvent.change(screen.getByLabelText("GeoTIFF file"), {
      target: { value: "D:\\ortho.jpg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start import" }));
    expect(await screen.findByText("Pick a .tif or .tiff file.")).toBeInTheDocument();
    expect(requests.some((r) => r.method === "POST")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: /Design surface/ })).toBeInTheDocument();
  });

  it("shows a synchronous 422 no_overlap refusal inline and keeps the dialog open (PF12b)", async () => {
    const onStarted = vi.fn();
    const { api, requests } = fakeClient([
      routes()[0],
      {
        method: "POST",
        path: /\/elevations$/,
        status: 422,
        body: {
          error: {
            code: "validation_error",
            message: "the file lies outside Sep DSM's coverage",
            details: { reason: "no_overlap" },
          },
        },
      },
    ]);
    const align = await open(api, onStarted);
    await waitFor(() => expect(align).toHaveValue(DEM_ID));
    fireEvent.change(screen.getByLabelText("GeoTIFF file"), {
      target: { value: "D:\\surveys\\sep-dsm.tif" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start import" }));
    expect(await screen.findByText("the file lies outside Sep DSM's coverage")).toBeInTheDocument();
    expect(requests.some((r) => r.method === "POST")).toBe(true);
    expect(onStarted).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start import" })).toBeInTheDocument();
  });
});
