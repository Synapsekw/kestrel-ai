import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  CLASS_ID,
  errorBody,
  exampleGeoMap,
  exampleLabel,
  exampleMapRun,
  exampleMapScore,
  exampleProject,
  exampleZone,
  fakeClient,
  MAP_ID,
  PROJECT_ID,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { useToastStore } from "@/ui";
import type { LabelLayerOptions } from "@/maps/labelLayers";
import { useLabelLayers } from "@/maps/labelLayers";
import { MapEvaluateScreen } from "./MapEvaluateScreen";

// OpenLayers needs a real canvas; the screen's own behaviour is what is under test here.
vi.mock("@/maps/MapView", () => ({
  MapView: ({ geoMap }: { geoMap: { name: string } }) => <div data-testid="map-view">{geoMap.name}</div>,
}));

// A real OL map never exists here (MapView is mocked), so a test drives the label layer's
// callbacks itself through the mocked hook's last options.
vi.mock("@/maps/labelLayers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/maps/labelLayers")>();
  return { ...actual, useLabelLayers: vi.fn() };
});

const ROUTE = `/p/${PROJECT_ID}/maps/${MAP_ID}/evaluate`;
const PATH = "/p/:projectId/maps/:mapId/evaluate";

/** The example map without coordinates: the maps this screen exists for (spec M16). */
const plain = {
  ...exampleGeoMap,
  crs_wkt: null,
  epsg: null,
  proj4: null,
  geotransform: null,
  gsd_cm: null,
};

const base = [
  { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
  { method: "GET", path: /\/maps$/, body: { items: [exampleGeoMap] } },
  { method: "GET", path: /\/maps\/[^/]+$/, body: exampleGeoMap },
  { method: "GET", path: /\/runs$/, body: { items: [] } },
  { method: "GET", path: /\/zones$/, body: { items: [] } },
  { method: "GET", path: /\/labels$/, body: { items: [] } },
];
const withMap = (m: typeof exampleGeoMap) => [
  base[0],
  { method: "GET", path: /\/maps$/, body: { items: [m] } },
  { method: "GET", path: /\/maps\/[^/]+$/, body: m },
];

function latestLabelLayerOpts(): LabelLayerOptions {
  const opts = vi.mocked(useLabelLayers).mock.calls.at(-1)?.[2];
  if (!opts) throw new Error("useLabelLayers was not called");
  return opts;
}

describe("MapEvaluateScreen", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {} }));

  it("opens a georeferenced map on Labels, without Results, and links back to the workspace", async () => {
    const { api } = fakeClient(base);
    renderWithProviders(<MapEvaluateScreen />, {
      api,
      route: ROUTE,
      path: PATH,
    });
    expect(await screen.findByTestId("map-view")).toHaveTextContent("Site north ortho");
    const panel = screen.getByTestId("map-panel");
    expect(panel).toHaveTextContent("EPSG:32633");
    expect(panel).toHaveTextContent("3.0 cm / px");
    expect(screen.getByRole("link", { name: "Open in map" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/maps?map=${MAP_ID}`,
    );
    expect(screen.getByRole("radio", { name: "Labels" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Score" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Results" })).not.toBeInTheDocument();
    // review, import and the map rail are the workspace's now
    expect(screen.queryByRole("button", { name: "Import map" })).not.toBeInTheDocument();
  });

  it("keeps Results for a map without coordinates, with its whole-map count", async () => {
    const { api, requests } = fakeClient([
      ...withMap(plain),
      { method: "GET", path: /\/runs$/, body: { items: [exampleMapRun] } },
      ...base.slice(4),
      {
        method: "GET",
        path: /\/density$/,
        body: {
          cell_size: 80000,
          cells: [{ gx: 0, gy: 0, class_id: CLASS_ID(1), count: 42 }],
        },
      },
      { method: "GET", path: /\/score/, body: exampleMapScore },
    ]);
    renderWithProviders(<MapEvaluateScreen />, {
      api,
      route: ROUTE,
      path: PATH,
    });
    expect(
      await within(screen.getByTestId("map-panel")).findByText(/No coordinates in this file/),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Results" })).toBeChecked();
    expect(screen.queryByRole("link", { name: "Open in map" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Show machinery-v3/ }));
    await waitFor(() => expect(screen.getByRole("row", { name: /excavator/ })).toHaveTextContent("42"));
    expect(
      requests.some((r) => r.method === "GET" && /\/density\?/.test(r.url) && r.url.includes("cells=1")),
    ).toBe(true);
  });

  it("scores a ticked run and opens the export dialog", async () => {
    const { api } = fakeClient([
      ...base.slice(0, 3),
      { method: "GET", path: /\/runs$/, body: { items: [exampleMapRun] } },
      ...base.slice(4),
      {
        method: "GET",
        path: /\/density$/,
        body: { cell_size: 80000, cells: [] },
      },
      { method: "GET", path: /\/score/, body: exampleMapScore },
    ]);
    renderWithProviders(<MapEvaluateScreen />, {
      api,
      route: ROUTE,
      path: PATH,
    });
    fireEvent.click(await screen.findByRole("checkbox", { name: /Show machinery-v3/ }));
    fireEvent.click(await screen.findByRole("radio", { name: "Score" }));
    expect(await screen.findByRole("row", { name: "Precision" })).toHaveTextContent("90.0 %");
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(await screen.findByText("Export boxes with coordinates")).toBeInTheDocument();
  });

  it("shows zones in the Labels tab and picks a class by hotkey", async () => {
    const { api, requests } = fakeClient([
      ...base.slice(0, 4),
      { method: "GET", path: /\/zones$/, body: { items: [exampleZone] } },
      { method: "GET", path: /\/labels$/, body: { items: [exampleLabel] } },
    ]);
    renderWithProviders(<MapEvaluateScreen />, {
      api,
      route: ROUTE,
      path: PATH,
    });
    expect(await screen.findByDisplayValue("Zone 1")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "4" });
    expect(screen.getByRole("button", { name: /dump_truck/ })).toHaveAttribute("aria-pressed", "true");
    expect(requests.some((r) => r.method === "PATCH")).toBe(false);
  });

  it("reclasses the selected label when a class is picked, and records history for undo", async () => {
    const { api, requests } = fakeClient([
      ...base.slice(0, 4),
      { method: "GET", path: /\/zones$/, body: { items: [exampleZone] } },
      { method: "GET", path: /\/labels$/, body: { items: [exampleLabel] } },
      {
        method: "PATCH",
        path: /\/labels\/[^/]+$/,
        body: { ...exampleLabel, class_id: CLASS_ID(4) },
      },
    ]);
    renderWithProviders(<MapEvaluateScreen />, {
      api,
      route: ROUTE,
      path: PATH,
    });
    await screen.findByDisplayValue("Zone 1");
    act(() => {
      latestLabelLayerOpts().onSelect(exampleLabel.id);
    });
    expect(await screen.findByText("A class here recolours the selected label.")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "4" });
    await waitFor(() =>
      expect(
        requests.some(
          (r) =>
            r.method === "PATCH" &&
            r.url.includes(`/labels/${exampleLabel.id}`) &&
            (r.body as { class_id?: string } | null)?.class_id === CLASS_ID(4),
        ),
      ).toBe(true),
    );
    expect(screen.getByRole("button", { name: "Undo" })).not.toBeDisabled();
  });

  it("reports a failed zone create instead of leaving it silent", async () => {
    useToastStore.setState({ toasts: [] });
    const { api } = fakeClient([
      ...base,
      {
        method: "POST",
        path: /\/zones$/,
        status: 500,
        body: errorBody("internal_error", "disk full"),
      },
    ]);
    renderWithProviders(<MapEvaluateScreen />, {
      api,
      route: ROUTE,
      path: PATH,
    });
    await screen.findByText(/Draw a zone around an area/);
    act(() => {
      latestLabelLayerOpts().onZone([
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ]);
    });
    await waitFor(() =>
      expect(useToastStore.getState().toasts.some((t) => t.text.includes("disk full"))).toBe(true),
    );
  });

  it("says so when the map is not in the project, with a way back", async () => {
    const { api } = fakeClient([
      base[0],
      { method: "GET", path: /\/maps$/, body: { items: [] } },
      ...base.slice(3),
    ]);
    renderWithProviders(<MapEvaluateScreen />, {
      api,
      route: ROUTE,
      path: PATH,
    });
    expect(await screen.findByText("This map is not in the project")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Maps" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/maps`,
    );
  });

  it("shows a retry when the map list fails to load", async () => {
    useToastStore.setState({ toasts: [] });
    const { api, requests } = fakeClient([
      base[0],
      {
        method: "GET",
        path: /\/maps$/,
        status: 500,
        body: errorBody("internal_error", "disk full"),
      },
    ]);
    renderWithProviders(<MapEvaluateScreen />, {
      api,
      route: ROUTE,
      path: PATH,
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(requests.filter((r) => /\/maps$/.test(r.url)).length).toBe(2));
  });
});
