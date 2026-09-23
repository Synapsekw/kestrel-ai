import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import {
  exampleGeoMap,
  exampleJob,
  exampleMapRun,
  exampleProject,
  exampleQueryRun,
  fakeClient,
  MAP_ID,
  PROJECT_ID,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { useProgressStore } from "@/store/progress";
import { PastDetectionsScreen } from "./PastDetectionsScreen";

// OpenLayers needs a real canvas; the read-only chrome is what is under test here.
vi.mock("@/maps/MapView", () => ({
  MapView: ({ geoMap }: { geoMap: { name: string } }) => <div data-testid="map-view">{geoMap.name}</div>,
}));

const progress = {
  images: 40,
  labeled: 10,
  pendingReview: 0,
  datasets: 1,
  models: 1,
  trainedModels: 1,
  queryRuns: 1,
  maps: 1,
};

const failedMapRun = { ...exampleMapRun, id: "r-failed", state: "failed" as const, job_id: null };

const routes = [
  { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
  { method: "GET", path: /\/query-runs$/, body: { items: [exampleQueryRun], next_cursor: null } },
  { method: "GET", path: /\/query-runs\/[^/]+$/, body: exampleQueryRun },
  { method: "GET", path: /\/jobs\/[^/]+$/, body: { ...exampleJob, type: "infer", state: "failed" } },
  { method: "GET", path: /\/maps$/, body: { items: [exampleGeoMap] } },
  { method: "GET", path: /\/maps\/[^/]+$/, body: exampleGeoMap },
  { method: "GET", path: /\/runs$/, body: { items: [exampleMapRun, failedMapRun] } },
  { method: "GET", path: /\/zones$/, body: { items: [] } },
  { method: "GET", path: /\/labels$/, body: { items: [] } },
];

function renderPast(route: string, path: string) {
  const { api, requests } = fakeClient(routes);
  renderWithProviders(<PastDetectionsScreen />, { api, route, path });
  return requests;
}

const NOTE =
  "Detections made before training and detection were split. New detections belong in a detection project.";

describe("PastDetectionsScreen", () => {
  beforeEach(() => {
    useJobsStore.setState({ jobs: {}, panelOpen: false });
    useProgressStore.setState({ byProject: { [PROJECT_ID]: progress } });
  });

  it("shows past detection runs read-only, with the note", async () => {
    renderPast(`/p/${PROJECT_ID}/past?run=${exampleQueryRun.id}`, "/p/:projectId/past");
    expect(screen.getByRole("heading", { name: "Past detections" })).toBeInTheDocument();
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    expect(await screen.findByTestId("run-card")).toBeInTheDocument();
    expect(await screen.findByTestId("run-history")).toBeInTheDocument();
    for (const name of [
      /New detection/,
      /Start/,
      /Estimate/,
      /Accept as labels/,
      /Resume run/,
      /Cancel job/,
    ]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByLabelText("Minimum confidence")).toBeNull();
  });

  it("shows past maps read-only: no New run, no import, no labeling, export stays", async () => {
    const requests = renderPast(`/p/${PROJECT_ID}/past/maps/${MAP_ID}`, "/p/:projectId/past/maps/:mapId");
    expect(await screen.findByTestId("map-view")).toHaveTextContent(exampleGeoMap.name);
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /^Maps/ })).toHaveAttribute("aria-checked", "true");
    await screen.findByRole("list", { name: "Runs" });
    expect(screen.queryByRole("button", { name: "New run" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Import map" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete run" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Resume run" })).toBeNull();
    const panel = screen.getByTestId("map-panel");
    expect(within(panel).queryByRole("radio", { name: "Labels" })).toBeNull();
    expect(within(panel).getByRole("button", { name: "Export" })).toBeInTheDocument();
    const link = within(screen.getByRole("list", { name: "Maps" })).getByRole("link");
    expect(link).toHaveAttribute("href", `/p/${PROJECT_ID}/past/maps/${MAP_ID}`);
    expect(requests.every((r) => r.method === "GET")).toBe(true);
  });

  it("switches between the detection runs and the maps", async () => {
    renderPast(`/p/${PROJECT_ID}/past`, "/p/:projectId/past");
    expect(await screen.findByTestId("run-history")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /^Maps/ }));
    expect(await screen.findByRole("list", { name: "Maps" })).toBeInTheDocument();
    expect(screen.queryByTestId("run-history")).toBeNull();
  });
});
