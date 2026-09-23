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
  runningJob,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { useToastStore } from "@/ui";
import { boxFacts } from "@/maps/runModel";
import type { LabelLayerOptions } from "@/maps/labelLayers";
import { useLabelLayers } from "@/maps/labelLayers";
import { MapsScreen } from "./MapsScreen";

// OpenLayers needs a real canvas; the screen's own behaviour is what is under test here.
vi.mock("@/maps/MapView", () => ({
  MapView: ({ geoMap }: { geoMap: { name: string } }) => <div data-testid="map-view">{geoMap.name}</div>,
}));

// A real OL map never exists in this test environment (MapView is mocked above), so the label
// layer's own Select interaction never fires. Mocking the hook lets a test call `onSelect` itself
// to simulate the operator having clicked a label, and drive the reclass flow that follows.
vi.mock("@/maps/labelLayers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/maps/labelLayers")>();
  return { ...actual, useLabelLayers: vi.fn() };
});

const base = [
  { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
  { method: "GET", path: /\/maps$/, body: { items: [exampleGeoMap] } },
  { method: "GET", path: /\/maps\/[^/]+$/, body: exampleGeoMap },
  { method: "GET", path: /\/runs$/, body: { items: [] } },
  { method: "GET", path: /\/zones$/, body: { items: [] } },
  { method: "GET", path: /\/labels$/, body: { items: [] } },
];

/** The options `useLabelLayers` was last called with (the hook is mocked above); a test drives
 * `onSelect`/`onZone` directly through it to stand in for an OpenLayers interaction that never
 * fires in this environment (`MapView` is mocked too, so there is never a real map). */
function latestLabelLayerOpts(): LabelLayerOptions {
  const opts = vi.mocked(useLabelLayers).mock.calls.at(-1)?.[2];
  if (!opts) throw new Error("useLabelLayers was not called");
  return opts;
}

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
      // Ticking a run also scores it in the background (Task 14), regardless of which tab is open.
      { method: "GET", path: /\/score/, body: exampleMapScore },
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

  it("scores a ticked run and opens the export dialog", async () => {
    const { api } = fakeClient([
      ...base.slice(0, 3),
      { method: "GET", path: /\/runs$/, body: { items: [exampleMapRun] } },
      ...base.slice(4),
      { method: "GET", path: /\/density$/, body: { cell_size: 80000, cells: [] } },
      { method: "GET", path: /\/score/, body: exampleMapScore },
    ]);
    renderWithProviders(<MapsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/maps/${MAP_ID}`,
      path: "/p/:projectId/maps/:mapId",
    });
    fireEvent.click(await screen.findByRole("checkbox", { name: /Show machinery-v3/ }));
    fireEvent.click(await screen.findByRole("radio", { name: "Score" }));
    expect(await screen.findByRole("row", { name: "Precision" })).toHaveTextContent("90.0 %");

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(await screen.findByText("Export boxes with coordinates")).toBeInTheDocument();
  });

  it("shows zones in the Labels tab and picks a class by hotkey", async () => {
    const { api, requests } = fakeClient([
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
    // nothing selected: this only changed the drawing class, no label was patched
    expect(requests.some((r) => r.method === "PATCH")).toBe(false);
  });

  it("reclasses the selected label when a class is picked, and records history for undo", async () => {
    const { api, requests } = fakeClient([
      ...base.slice(0, 3),
      { method: "GET", path: /\/runs$/, body: { items: [] } },
      { method: "GET", path: /\/zones$/, body: { items: [exampleZone] } },
      { method: "GET", path: /\/labels$/, body: { items: [exampleLabel] } },
      { method: "PATCH", path: /\/labels\/[^/]+$/, body: { ...exampleLabel, class_id: CLASS_ID(4) } },
    ]);
    renderWithProviders(<MapsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/maps/${MAP_ID}`,
      path: "/p/:projectId/maps/:mapId",
    });
    await screen.findByTestId("map-view");
    fireEvent.click(await screen.findByRole("radio", { name: "Labels" }));
    await screen.findByDisplayValue("Zone 1");

    act(() => {
      latestLabelLayerOpts().onSelect(exampleLabel.id);
    });
    expect(await screen.findByText("A class here recolours the selected label.")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "4" }); // dump_truck's hotkey
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

  it("shows a retry when the map list fails to load, instead of an empty rail", async () => {
    useToastStore.setState({ toasts: [] });
    const { api, requests } = fakeClient([
      base[0],
      { method: "GET", path: /\/maps$/, status: 500, body: errorBody("internal_error", "disk full") },
    ]);
    renderWithProviders(<MapsScreen />, { api, route: `/p/${PROJECT_ID}/maps`, path: "/p/:projectId/maps" });
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
    expect(useToastStore.getState().toasts.some((t) => t.text.includes("disk full"))).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(requests.filter((r) => /\/maps$/.test(r.url)).length).toBe(2));
  });

  it("reports a failed zone create instead of leaving it silent", async () => {
    useToastStore.setState({ toasts: [] });
    const { api } = fakeClient([
      ...base.slice(0, 3),
      { method: "GET", path: /\/runs$/, body: { items: [] } },
      { method: "GET", path: /\/zones$/, body: { items: [] } },
      { method: "GET", path: /\/labels$/, body: { items: [] } },
      { method: "POST", path: /\/zones$/, status: 500, body: errorBody("internal_error", "disk full") },
    ]);
    renderWithProviders(<MapsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/maps/${MAP_ID}`,
      path: "/p/:projectId/maps/:mapId",
    });
    await screen.findByTestId("map-view");
    fireEvent.click(await screen.findByRole("radio", { name: "Labels" }));
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
  describe("review mode", () => {
    const reviewRoutes = [
      ...base.slice(0, 3),
      { method: "GET", path: /\/runs$/, body: { items: [exampleMapRun] } },
      ...base.slice(4),
      { method: "GET", path: /\/density$/, body: { cell_size: 80000, cells: [] } },
      { method: "GET", path: /\/score/, body: exampleMapScore },
      {
        method: "GET",
        path: /\/next-unreviewed$/,
        body: {
          detection: {
            id: "d1",
            class_id: CLASS_ID(1),
            confidence: 0.64,
            x: 3000,
            y: 2400,
            w: 170,
            h: 110,
            angle: null,
            review_state: "unreviewed",
            provenance_kind: "local_model",
          },
          remaining: 20,
        },
      },
      {
        method: "POST",
        path: /\/map-runs\/[^/]+\/detections$/,
        status: 201,
        body: {
          id: "p1",
          class_id: CLASS_ID(2),
          confidence: 1,
          x: 10,
          y: 20,
          w: 30,
          h: 40,
          angle: null,
          review_state: "accepted",
          provenance_kind: "person",
        },
      },
    ];

    function renderReview(api: Parameters<typeof renderWithProviders>[1]["api"]) {
      renderWithProviders(<MapsScreen />, {
        api,
        route: `/p/${PROJECT_ID}/maps/${MAP_ID}?mode=review&run=${exampleMapRun.id}`,
        path: "/p/:projectId/maps/:mapId",
      });
    }

    it("replaces the tabs with the review panel for the run in the address", async () => {
      const { api } = fakeClient(reviewRoutes);
      renderReview(api);
      const panel = await screen.findByRole("region", { name: "Review" });
      expect(await within(panel).findByText("39 of 59 reviewed")).toBeInTheDocument();
      expect(screen.queryByRole("radio", { name: "Labels" })).not.toBeInTheDocument();
      // The reviewed run is the one drawn on the map.
      expect(screen.getByRole("checkbox", { name: /Show machinery-v3/ })).toBeChecked();
    });

    it("draws a missed object into the run", async () => {
      const { api, requests } = fakeClient(reviewRoutes);
      renderReview(api);
      await screen.findByText("39 of 59 reviewed");
      expect(latestLabelLayerOpts().tool).toBe("pan");
      fireEvent.click(screen.getByRole("button", { name: "Draw missed object" }));
      await waitFor(() => expect(latestLabelLayerOpts().tool).toBe("box"));
      fireEvent.change(screen.getByLabelText("Draws as"), { target: { value: CLASS_ID(2) } });
      act(() => latestLabelLayerOpts().onBox?.({ x: 10, y: 20, w: 30, h: 40 }));
      await waitFor(() =>
        expect(requests.find((r) => r.method === "POST" && r.url.endsWith("/detections"))?.body).toEqual({
          class_id: CLASS_ID(2),
          x: 10,
          y: 20,
          w: 30,
          h: 40,
        }),
      );
      // Drawing in review never creates a ground-truth label.
      expect(requests.some((r) => r.method === "POST" && r.url.endsWith("/labels"))).toBe(false);
    });

    it("leaves review mode back to the tabs", async () => {
      const { api } = fakeClient(reviewRoutes);
      renderReview(api);
      fireEvent.click(await screen.findByRole("button", { name: "Leave review" }));
      expect(await screen.findByRole("radio", { name: "Labels" })).toBeInTheDocument();
    });
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
