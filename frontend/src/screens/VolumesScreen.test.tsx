import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { exampleProject, fakeClient, runningJob } from "@/test/fixtures";
import {
  CLOUD_ID,
  MEASUREMENT_ID,
  PROJECT_ID,
  exampleMeasurement,
  exampleSurface,
} from "@/test/volumeFixtures";
import { renderWithProviders } from "@/test/render";
import { useDiffLayer } from "@/volumes/diffLayer";
import { useVolumeLayers, type VolumeLayerOptions } from "@/volumes/volumeLayers";
import { VolumesScreen } from "./VolumesScreen";

// OpenLayers needs a real canvas: the view is a stub, and a test drives the drawing hook's
// callbacks itself, standing in for a finished OpenLayers Draw.
vi.mock("@/volumes/SurfaceView", () => ({
  SurfaceView: ({ surface }: { surface: { name: string } }) => (
    <div data-testid="surface-view">{surface.name}</div>
  ),
}));
vi.mock("@/volumes/volumeLayers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/volumes/volumeLayers")>();
  return { ...actual, useVolumeLayers: vi.fn() };
});
vi.mock("@/volumes/diffLayer", () => ({ useDiffLayer: vi.fn() }));

function layerOpts(): VolumeLayerOptions {
  const opts = vi.mocked(useVolumeLayers).mock.calls.at(-1)?.[1];
  if (!opts) throw new Error("useVolumeLayers was not called");
  return opts;
}

const cloud = { id: CLOUD_ID, name: "Chimney", status: "ready", crs_wkt: "PROJCS[...]" };
const base = (surfaces: unknown[], volumes: unknown[], clouds: unknown[] = [cloud]) => [
  { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
  { method: "GET", path: /\/surfaces$/, body: { items: surfaces } },
  { method: "GET", path: /\/volumes$/, body: { items: volumes } },
  { method: "GET", path: /\/pointclouds$/, body: { items: clouds } },
  { method: "GET", path: /\/maps$/, body: { items: [] } },
];

describe("VolumesScreen", () => {
  beforeEach(() => vi.mocked(useVolumeLayers).mockClear());

  it("asks for a point cloud first, then for a surface", async () => {
    const { api } = fakeClient(base([], [], []));
    renderWithProviders(<VolumesScreen />, {
      api,
      route: `/p/${PROJECT_ID}/volumes`,
      path: "/p/:projectId/volumes",
    });
    expect(await screen.findByText("Import a point cloud first")).toBeInTheDocument();
    const second = fakeClient(base([], []));
    renderWithProviders(<VolumesScreen />, {
      api: second.api,
      route: `/p/${PROJECT_ID}/volumes`,
      path: "/p/:projectId/volumes",
    });
    expect(await screen.findByText("Build a surface from a point cloud")).toBeInTheDocument();
  });

  it("still lists surfaces and measurements while point clouds answer 501", async () => {
    const notBuilt = {
      method: "GET",
      path: /\/pointclouds$/,
      status: 501,
      body: { error: { code: "not_implemented", message: "not implemented yet" } },
    };
    const empty = fakeClient([notBuilt, ...base([], [], [])]);
    renderWithProviders(<VolumesScreen />, {
      api: empty.api,
      route: `/p/${PROJECT_ID}/volumes`,
      path: "/p/:projectId/volumes",
    });
    expect(await screen.findByText("Import a point cloud first")).toBeInTheDocument();
    const listed = fakeClient([notBuilt, ...base([exampleSurface], [exampleMeasurement], [])]);
    renderWithProviders(<VolumesScreen />, {
      api: listed.api,
      route: `/p/${PROJECT_ID}/volumes/${MEASUREMENT_ID}`,
      path: "/p/:projectId/volumes/:measurementId",
    });
    expect(await screen.findByTestId("surface-view")).toHaveTextContent("April survey");
    expect(screen.getByRole("list", { name: "Measurements" })).toHaveTextContent("Pile 1");
    expect(screen.queryByText(/could not load/)).not.toBeInTheDocument();
  });

  it("shows the cut/fill layer only on the top the results were computed on", async () => {
    const other = { ...exampleSurface, id: "s-other", name: "May survey" };
    const moved = { ...exampleMeasurement, status: "stale", top_surface_id: other.id };
    const { api } = fakeClient(base([exampleSurface, other], [moved]));
    const first = renderWithProviders(<VolumesScreen />, {
      api,
      route: `/p/${PROJECT_ID}/volumes/${MEASUREMENT_ID}`,
      path: "/p/:projectId/volumes/:measurementId",
    });
    expect(await screen.findByTestId("surface-view")).toHaveTextContent("May survey");
    expect(vi.mocked(useDiffLayer).mock.calls.at(-1)?.[2]).toBeNull();
    expect(screen.queryByRole("switch", { name: "Cut / fill" })).not.toBeInTheDocument();

    first.unmount();
    const same = fakeClient(base([exampleSurface], [exampleMeasurement]));
    vi.mocked(useDiffLayer).mockClear();
    renderWithProviders(<VolumesScreen />, {
      api: same.api,
      route: `/p/${PROJECT_ID}/volumes/${MEASUREMENT_ID}`,
      path: "/p/:projectId/volumes/:measurementId",
    });
    await waitFor(() => expect(vi.mocked(useDiffLayer).mock.calls.at(-1)?.[2]).toContain("/diff-tiles/"));
  });

  it("lists surfaces and measurements and shows a stale measurement's reasons", async () => {
    const stale = { ...exampleMeasurement, status: "stale", stale_reasons: ["base changed"] };
    const { api } = fakeClient(base([exampleSurface], [stale]));
    renderWithProviders(<VolumesScreen />, {
      api,
      route: `/p/${PROJECT_ID}/volumes/${MEASUREMENT_ID}`,
      path: "/p/:projectId/volumes/:measurementId",
    });
    expect(await screen.findByTestId("surface-view")).toHaveTextContent("April survey");
    expect(screen.getByRole("list", { name: "Surfaces" })).toHaveTextContent("From cloud");
    expect(screen.getByRole("list", { name: "Measurements" })).toHaveTextContent("1 234.5 m³");
    expect(await screen.findByText("Inputs changed: base changed — Recalculate")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revert to last calculated inputs" })).toBeInTheDocument();
  });

  it("a polygon drawn with no measurement open creates one with the defaults", async () => {
    const { api, requests } = fakeClient([
      ...base([exampleSurface], []),
      {
        method: "POST",
        path: /\/volumes$/,
        status: 202,
        body: {
          measurement: { ...exampleMeasurement, status: "calculating" },
          job: { ...runningJob, type: "volume_calc" },
        },
      },
    ]);
    renderWithProviders(<VolumesScreen />, {
      api,
      route: `/p/${PROJECT_ID}/volumes`,
      path: "/p/:projectId/volumes/*",
    });
    await screen.findByTestId("surface-view");
    fireEvent.click(screen.getByRole("button", { name: /Draw measurement/ }));
    await waitFor(() => expect(layerOpts().tool).toBe("measure"));
    const ring = [
      [500010, 3299990],
      [500030, 3299990],
      [500030, 3299970],
    ];
    act(() => layerOpts().onDrawn("measure", ring));
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    expect(requests.find((r) => r.method === "POST")?.body).toEqual({
      name: "Pile 1",
      polygon_native: ring,
      top_surface_id: exampleSurface.id,
      base: { kind: "toe_plane" },
    });
    // The Draw tool must not stay armed: the next polygon drawn should not silently overwrite
    // this measurement's own polygon.
    await waitFor(() => expect(layerOpts().tool).toBe("pan"));
  });
});
