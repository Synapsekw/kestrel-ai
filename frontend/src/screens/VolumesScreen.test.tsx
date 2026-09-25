import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { exampleProject, fakeClient, runningJob } from "@/test/fixtures";
import { CLOUD_ID, PROJECT_ID, exampleMeasurement, exampleSurface } from "@/test/volumeFixtures";
import { renderWithProviders } from "@/test/render";
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
  });
});
