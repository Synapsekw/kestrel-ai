import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  CLASS_ID,
  exampleGeoMap,
  exampleLabel,
  exampleMapRun,
  exampleProject,
  exampleZone,
  fakeClient,
  MAP_ID,
  PROJECT_ID,
  runningJob,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { boxFacts } from "@/maps/runModel";
import { MapsScreen } from "./MapsScreen";

// OpenLayers needs a real canvas; the screen's own behaviour is what is under test here.
vi.mock("@/maps/MapView", () => ({
  MapView: ({ geoMap }: { geoMap: { name: string } }) => <div data-testid="map-view">{geoMap.name}</div>,
}));

const base = [
  { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
  { method: "GET", path: /\/maps$/, body: { items: [exampleGeoMap] } },
  { method: "GET", path: /\/maps\/[^/]+$/, body: exampleGeoMap },
  { method: "GET", path: /\/runs$/, body: { items: [] } },
  { method: "GET", path: /\/zones$/, body: { items: [] } },
  { method: "GET", path: /\/labels$/, body: { items: [] } },
];

describe("MapsScreen", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("teaches the empty state", async () => {
    const { api } = fakeClient([
      ...base.slice(0, 1),
      { method: "GET", path: /\/maps$/, body: { items: [] } },
    ]);
    renderWithProviders(<MapsScreen />, { api, route: `/p/${PROJECT_ID}/maps`, path: "/p/:projectId/maps" });
    expect(await screen.findByText("Import a GeoTIFF map")).toBeInTheDocument();
  });

  it("lists maps and opens one with its coordinate facts", async () => {
    const { api } = fakeClient(base);
    renderWithProviders(<MapsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/maps/${MAP_ID}`,
      path: "/p/:projectId/maps/:mapId",
    });
    expect(await screen.findByTestId("map-view")).toHaveTextContent("Site north ortho");
    const panel = screen.getByTestId("map-panel");
    expect(panel).toHaveTextContent("EPSG:32633");
    expect(panel).toHaveTextContent("3.0 cm / px");
    expect(panel).toHaveTextContent("80 000 × 60 000 px");
  });

  it("imports a file by path and tracks the job", async () => {
    const { api, requests } = fakeClient([
      ...base,
      {
        method: "POST",
        path: /\/maps$/,
        status: 202,
        body: { map: { ...exampleGeoMap, status: "importing" }, job: { ...runningJob, type: "map_import" } },
      },
    ]);
    renderWithProviders(<MapsScreen />, { api, route: `/p/${PROJECT_ID}/maps`, path: "/p/:projectId/maps" });
    fireEvent.click(await screen.findByRole("button", { name: "Import map" }));
    fireEvent.change(screen.getByLabelText("GeoTIFF file"), { target: { value: "D:/orthos/new.tif" } });
    fireEvent.click(screen.getByRole("button", { name: "Start import" }));
    await waitFor(() =>
      expect(
        requests.some(
          (r) => r.method === "POST" && (r.body as { path?: string } | null)?.path === "D:/orthos/new.tif",
        ),
      ).toBe(true),
    );
    expect(useJobsStore.getState().jobs[runningJob.id]?.type).toBe("map_import");
  });

  it("says why geo export is unavailable for a map without coordinates", async () => {
    const plain = {
      ...exampleGeoMap,
      crs_wkt: null,
      epsg: null,
      proj4: null,
      geotransform: null,
      gsd_cm: null,
    };
    const { api } = fakeClient([
      base[0],
      { method: "GET", path: /\/maps$/, body: { items: [plain] } },
      { method: "GET", path: /\/maps\/[^/]+$/, body: plain },
      ...base.slice(3),
    ]);
    renderWithProviders(<MapsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/maps/${MAP_ID}`,
      path: "/p/:projectId/maps/:mapId",
    });
    // the list row says "No coordinates" too; the panel's explanation is what matters here
    expect(
      await within(screen.getByTestId("map-panel")).findByText(/No coordinates in this file/),
    ).toBeInTheDocument();
  });

  it("shows the whole-map count for a ticked run", async () => {
    const { api, requests } = fakeClient([
      ...base.slice(0, 3),
      { method: "GET", path: /\/runs$/, body: { items: [exampleMapRun] } },
      ...base.slice(4),
      {
        method: "GET",
        path: /\/density$/,
        body: { cell_size: 80000, cells: [{ gx: 0, gy: 0, class_id: CLASS_ID(1), count: 42 }] },
      },
    ]);
    renderWithProviders(<MapsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/maps/${MAP_ID}`,
      path: "/p/:projectId/maps/:mapId",
    });
    fireEvent.click(await screen.findByRole("checkbox", { name: /Show machinery-v3/ }));
    await waitFor(() => expect(screen.getByRole("row", { name: /excavator/ })).toHaveTextContent("42"));
    expect(
      requests.some((r) => r.method === "GET" && /\/density\?/.test(r.url) && r.url.includes("cells=1")),
    ).toBe(true);
  });

  it("shows zones in the Labels tab and picks a class by hotkey", async () => {
    const { api } = fakeClient([
      ...base.slice(0, 3),
      { method: "GET", path: /\/runs$/, body: { items: [] } },
      { method: "GET", path: /\/zones$/, body: { items: [exampleZone] } },
      { method: "GET", path: /\/labels$/, body: { items: [exampleLabel] } },
    ]);
    renderWithProviders(<MapsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/maps/${MAP_ID}`,
      path: "/p/:projectId/maps/:mapId",
    });
    await screen.findByTestId("map-view");
    fireEvent.click(await screen.findByRole("radio", { name: "Labels" }));
    expect(await screen.findByDisplayValue("Zone 1")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "4" });
    expect(screen.getByRole("button", { name: /dump_truck/ })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("boxFacts", () => {
  it("gives the popover's size and native centre for the UTM example map", () => {
    const facts = boxFacts(
      exampleGeoMap,
      { x: 1000, y: 2000, w: 100, h: 50, classId: CLASS_ID(1) },
      exampleProject.classes,
      0.91,
    );
    expect(facts.size).toBe("3.0 × 1.5 m");
    expect(facts.readout.native).toBe("500031.50, 4982939.25 · EPSG:32633");
  });
});
