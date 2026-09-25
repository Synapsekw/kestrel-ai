import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { exampleGeoMap, exampleMapRun, exampleProject, fakeClient, runningJob } from "@/test/fixtures";
import {
  PROJECT_ID,
  exampleBaseSurface,
  exampleMeasurement,
  exampleSurface,
  otherFlightRun,
} from "@/test/volumeFixtures";
import { MemoryRouter } from "react-router-dom";
import { TestApiProvider, renderWithProviders } from "@/test/render";
import { ExportVolumesDialog } from "./ExportVolumesDialog";
import { MeasurePanel } from "./MeasurePanel";
import { VolumeResultsPanel } from "./VolumeResultsPanel";

const routes = [
  { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
  {
    method: "GET",
    path: /\/maps$/,
    body: { items: [exampleGeoMap, { ...exampleGeoMap, id: "other-map", name: "March ortho" }] },
  },
  { method: "GET", path: /\/maps\/[^/]+\/runs$/, body: { items: [exampleMapRun, otherFlightRun] } },
];

describe("MeasurePanel", () => {
  it("groups runs by flight and saves a ticked run at once", async () => {
    const { api } = fakeClient(routes);
    const onSave = vi.fn();
    renderWithProviders(
      <MeasurePanel
        projectId={PROJECT_ID}
        measurement={exampleMeasurement}
        top={exampleSurface}
        surfaces={[exampleSurface, exampleBaseSurface]}
        picking={false}
        onPick={() => {}}
        onSave={onSave}
        onChanged={() => {}}
      />,
      { api },
    );
    expect(await screen.findByText("Same flight as top")).toBeInTheDocument();
    expect(screen.getByText("Other maps")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(onSave).toHaveBeenCalledWith({ masks: { detection_run_ids: [exampleMapRun.id] } });
  });

  it("switching to a flat base saves a level", () => {
    const { api } = fakeClient(routes);
    const onSave = vi.fn();
    renderWithProviders(
      <MeasurePanel
        projectId={PROJECT_ID}
        measurement={exampleMeasurement}
        top={exampleSurface}
        surfaces={[exampleSurface]}
        picking={false}
        onPick={() => {}}
        onSave={onSave}
        onChanged={() => {}}
      />,
      { api },
    );
    fireEvent.change(screen.getByLabelText("Base"), { target: { value: "flat" } });
    expect(onSave).toHaveBeenCalledWith({ base: { kind: "flat", z: exampleSurface.z_min } });
  });

  it("a flat base offers Pick on map and says where the ground is", () => {
    const { api } = fakeClient(routes);
    const onPick = vi.fn();
    renderWithProviders(
      <MeasurePanel
        projectId={PROJECT_ID}
        measurement={{ ...exampleMeasurement, base: { kind: "flat", z: -45, surface_id: null } }}
        top={exampleSurface}
        surfaces={[exampleSurface]}
        picking={false}
        onPick={onPick}
        onSave={() => {}}
        onChanged={() => {}}
      />,
      { api },
    );
    fireEvent.click(screen.getByRole("button", { name: "Pick on map" }));
    expect(onPick).toHaveBeenCalled();
    expect(screen.getByText(/ground is near -46 m/)).toBeInTheDocument();
  });

  it("offers as base only surfaces in the top surface's CRS", () => {
    const { api } = fakeClient(routes);
    const otherZone = {
      ...exampleBaseSurface,
      id: "other-zone",
      name: "Zone 40 survey",
      epsg: 32640,
      crs_wkt: 'PROJCS["WGS 84 / UTM zone 40N"]',
    };
    renderWithProviders(
      <MeasurePanel
        projectId={PROJECT_ID}
        measurement={{
          ...exampleMeasurement,
          base: { kind: "surface", z: null, surface_id: exampleBaseSurface.id },
        }}
        top={exampleSurface}
        surfaces={[exampleSurface, exampleBaseSurface, otherZone]}
        picking={false}
        onPick={() => {}}
        onSave={() => {}}
        onChanged={() => {}}
      />,
      { api },
    );
    const options = Array.from(screen.getByLabelText("Base surface").querySelectorAll("option"));
    expect(options.map((o) => o.value)).toEqual([exampleBaseSurface.id]);
  });

  it("the buffer field follows the stored value after a revert", () => {
    const { api } = fakeClient(routes);
    const panel = (buffer_m: number) => (
      <TestApiProvider api={api}>
        <MemoryRouter>
          <MeasurePanel
            projectId={PROJECT_ID}
            measurement={{ ...exampleMeasurement, masks: { ...exampleMeasurement.masks, buffer_m } }}
            top={exampleSurface}
            surfaces={[exampleSurface]}
            picking={false}
            onPick={() => {}}
            onSave={() => {}}
            onChanged={() => {}}
          />
        </MemoryRouter>
      </TestApiProvider>
    );
    const { rerender } = render(panel(1));
    expect(screen.getByLabelText("Buffer around machines (m)")).toHaveValue(1);
    rerender(panel(2.5));
    expect(screen.getByLabelText("Buffer around machines (m)")).toHaveValue(2.5);
  });

  it("Calculate starts the job", async () => {
    const { api, requests } = fakeClient([
      ...routes,
      {
        method: "POST",
        path: /\/calculate$/,
        status: 202,
        body: {
          measurement: { ...exampleMeasurement, status: "calculating" },
          job: { ...runningJob, type: "volume_calc" },
        },
      },
    ]);
    const onChanged = vi.fn();
    renderWithProviders(
      <MeasurePanel
        projectId={PROJECT_ID}
        measurement={exampleMeasurement}
        top={exampleSurface}
        surfaces={[exampleSurface]}
        picking={false}
        onPick={() => {}}
        onSave={() => {}}
        onChanged={onChanged}
      />,
      { api },
    );
    fireEvent.click(screen.getByRole("button", { name: "Calculate" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(requests.some((r) => r.method === "POST" && r.url.endsWith("/calculate"))).toBe(true);
  });
});

describe("VolumeResultsPanel", () => {
  it("labels the numbers for a stockpile and prints the ±", () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <VolumeResultsPanel
        projectId={PROJECT_ID}
        measurement={exampleMeasurement}
        top={exampleSurface}
        onExport={() => {}}
      />,
      { api },
    );
    expect(screen.getByText("Stockpile volume (above base)")).toBeInTheDocument();
    expect(screen.getByText("1 234.5 m³")).toBeInTheDocument();
    expect(screen.getByText("± 14.2 m³ (indicative)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View in 3D" })).toHaveAttribute(
      "href",
      expect.stringContaining(`/clouds/${exampleSurface.point_cloud_id}?at=`),
    );
  });

  it("labels change since an earlier survey and shows the alignment verdict", () => {
    const { api } = fakeClient([]);
    const r = exampleMeasurement.results!;
    const m = {
      ...exampleMeasurement,
      base: { kind: "surface" as const, z: null, surface_id: exampleBaseSurface.id },
      results: {
        ...r,
        base_surface: { ...r.top_surface, id: exampleBaseSurface.id, captured_on: "2026-03-01" },
        alignment: {
          n_cells: 12000,
          median_dz: 0.1,
          mad: 0.01,
          sigma: 0.015,
          tilt_mm_per_m: 0.1,
          span_m: 90,
        },
        warnings: [
          {
            code: "alignment_offset" as const,
            severity: "warn" as const,
            message: "surveys differ by +0.100 m",
          },
        ],
      },
    };
    renderWithProviders(
      <VolumeResultsPanel projectId={PROJECT_ID} measurement={m} top={exampleSurface} onExport={() => {}} />,
      {
        api,
      },
    );
    expect(screen.getByText("Added since 2026-03-01 (fill)")).toBeInTheDocument();
    expect(screen.getByText(/surveys differ by \+0.100 m/)).toBeInTheDocument();
  });
});

describe("ExportVolumesDialog", () => {
  it("disables stale measurements with the reason and exports the rest in every format", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/volume-exports$/,
        status: 202,
        body: { job: { ...runningJob, type: "volume_export" } },
      },
    ]);
    const stale = { ...exampleMeasurement, id: "stale", name: "Pile 2", status: "stale" as const };
    renderWithProviders(
      <ExportVolumesDialog
        projectId={PROJECT_ID}
        measurements={[exampleMeasurement, stale]}
        preselected={[]}
        onClose={() => {}}
      />,
      { api },
    );
    expect(screen.getByRole("checkbox", { name: /Pile 2/ })).toBeDisabled();
    expect(screen.getByText(/inputs changed — recalculate first/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].body).toEqual({
      measurement_ids: [exampleMeasurement.id],
      formats: ["pdf", "gpkg", "csv", "xlsx"],
    });
  });
});
