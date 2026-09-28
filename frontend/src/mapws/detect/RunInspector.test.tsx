import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import {
  MAP_RUN_ID,
  PROJECT_ID,
  exampleMapRun,
  fakeClient,
  runningJob,
  type FakeRoute,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { RunInspector } from "./RunInspector";

const h = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("@/mapws/w4host", () => ({
  useWorkspace: (sel: (s: unknown) => unknown) => sel({ select: h.select, viewApi: null }),
}));

const FRAME = {
  kind: "crs" as const,
  epsg: 32639,
  crs_wkt: "X",
  proj4: "+proj=utm",
  name: "UTM",
};
const det = {
  id: "d7",
  class_id: "c1",
  confidence: 0.8,
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  angle: null,
  review_state: "unreviewed" as const,
  provenance_kind: "local_model" as const,
  corners_site: null,
};

const render = (routes: FakeRoute[]) => {
  const client = fakeClient(routes);
  renderWithProviders(
    <RunInspector
      selection={{ kind: "run", id: MAP_RUN_ID }}
      projectId={PROJECT_ID}
      frame={FRAME}
      onClose={() => {}}
    />,
    { api: client.api },
  );
  return client;
};

describe("RunInspector", () => {
  beforeEach(() => {
    h.select.mockReset();
    useJobsStore.setState({ jobs: {} });
  });

  it("starts review of a finished run at its first pending detection", async () => {
    const { requests } = render([
      { method: "GET", path: /\/map-runs\/[^/]+$/, body: exampleMapRun },
      {
        method: "GET",
        path: /\/next-unreviewed$/,
        body: { detection: det, remaining: 3 },
      },
    ]);
    expect(await screen.findByTestId("run-inspector")).toHaveTextContent("machinery-v3");
    expect(screen.getByText("59 detections")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Start review/ }));
    await waitFor(() => expect(h.select).toHaveBeenCalledWith({ kind: "detection", id: `${MAP_RUN_ID}.d7` }));
    const next = requests.find((r) => r.url.includes("/next-unreviewed"));
    expect(next?.url).toContain("frame=site");
  });

  it("labels the run state in sentence case", async () => {
    render([{ method: "GET", path: /\/map-runs\/[^/]+$/, body: { ...exampleMapRun, state: "cancelled" } }]);
    expect(await screen.findByTestId("run-inspector")).toHaveTextContent("Cancelled");
    expect(screen.getByTestId("run-inspector")).not.toHaveTextContent("cancelled");
  });

  it("labels a finished run Succeeded", async () => {
    render([{ method: "GET", path: /\/map-runs\/[^/]+$/, body: exampleMapRun }]);
    expect(await screen.findByTestId("run-inspector")).toHaveTextContent("Succeeded");
  });

  it("shows a running region run's progress", async () => {
    const job = { ...runningJob, type: "map_detect" as const };
    render([
      {
        method: "GET",
        path: /\/map-runs\/[^/]+$/,
        body: { ...exampleMapRun, state: "running", scope: "region", job_id: job.id, detection_count: 0 },
      },
      { method: "GET", path: /\/jobs\/[^/]+$/, body: job },
    ]);
    expect(await screen.findByTestId("run-inspector")).toHaveTextContent("Region");
    expect(screen.queryByRole("button", { name: /Start review/ })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("progressbar", { name: "Detecting" })).toHaveAttribute("aria-valuenow", "42"),
    );
    expect(screen.getByText(/never changes the survey's counts/)).toBeInTheDocument();
  });

  it("says when the run cannot be loaded", async () => {
    render([
      {
        method: "GET",
        path: /\/map-runs\/[^/]+$/,
        status: 404,
        body: { error: { code: "not_found", message: "run not found", details: {} } },
      },
    ]);
    expect(await screen.findByRole("alert")).toHaveTextContent(/run not found/);
  });
});
