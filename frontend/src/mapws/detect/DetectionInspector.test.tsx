import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { MAP_ID, MAP_RUN_ID, PROJECT_ID, exampleMapRun, fakeClient, type FakeRoute } from "@/test/fixtures";
import { TYPE_CRACK, typedProject } from "@/test/findingFixtures";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { detectionHint } from "./detectionHint";
import { useDetectStore } from "./detectStore";
import { DetectionInspector } from "./DetectionInspector";

const h = vi.hoisted(() => ({ select: vi.fn(), open3d: vi.fn() }));
vi.mock("@/mapws/w4host", async () => {
  const { formatSurveyDate } = await import("@/mapws/timeline/timelineModel");
  return {
    formatSurveyDate,
    useWorkspace: (sel: (s: unknown) => unknown) =>
      sel({
        select: h.select,
        viewApi: null,
        surveys: [
          {
            date: "2026-09-14",
            planned: false,
            maps: [
              {
                id: "a0000000-6666-4000-8000-000000000001",
                name: "Ortho",
                gsd_cm: 3,
                basis_run_id: null,
              },
            ],
          },
        ],
      }),
    useOpenIn3d: () => h.open3d,
  };
});

const corners = [
  [0, 0],
  [2, 0],
  [2, 2],
  [0, 2],
];
const det = {
  id: "d1",
  class_id: TYPE_CRACK,
  confidence: 0.91,
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  angle: null,
  review_state: "unreviewed" as const,
  provenance_kind: "local_model" as const,
  corners_site: corners,
};
const FRAME = {
  kind: "crs" as const,
  epsg: 32639,
  crs_wkt: "X",
  proj4: "+proj=utm",
  name: "UTM",
};
const routes = (extra: FakeRoute[] = []): FakeRoute[] => [
  { method: "GET", path: /\/projects\/[^/]+$/, body: typedProject },
  {
    method: "GET",
    path: /\/map-runs\/[^/]+$/,
    body: { ...exampleMapRun, map_id: MAP_ID },
  },
  ...extra,
];
const refusedReject = () =>
  routes([
    {
      method: "POST",
      path: /\/review$/,
      status: 409,
      body: {
        error: {
          code: "finding_would_be_deleted",
          message: "x",
          details: { finding_id: "f5", finding_ids: ["f5"], count: 1 },
        },
      },
    },
  ]);
const render = (api: ReturnType<typeof fakeClient>["api"], id = `${MAP_RUN_ID}.d1`) =>
  renderWithProviders(
    <>
      <DetectionInspector
        selection={{ kind: "detection", id }}
        projectId={PROJECT_ID}
        frame={FRAME}
        onClose={() => {}}
      />
      <LocationProbe />
    </>,
    { api },
  );
const accepted = () =>
  useDetectStore.setState({
    byId: new Map([["d1", { runId: MAP_RUN_ID, d: { ...det, review_state: "accepted" as const } }]]),
  });

describe("DetectionInspector", () => {
  beforeEach(() => {
    h.select.mockReset();
    h.open3d.mockReset().mockReturnValue({
      href: null,
      reason: "No point cloud is linked to the 2026-09-14 survey.",
    });
    useChangesStore.setState({ openProjectId: null });
    useDetectStore.setState({
      byId: new Map([["d1", { runId: MAP_RUN_ID, d: det }]]),
      history: [],
    });
  });

  it("shows type, confidence, model, map date and review state; the hint reads the review keys", async () => {
    render(fakeClient(routes()).api);
    expect(await screen.findByTestId("detection-inspector")).toBeInTheDocument();
    expect(screen.getByTestId("review-current")).toHaveAttribute("data-id", "d1");
    expect(screen.getByText("91 %")).toBeInTheDocument();
    expect(screen.getByText("Not reviewed")).toBeInTheDocument();
    expect(await screen.findByText(/machinery-v3/)).toBeInTheDocument();
    expect(screen.getByText(/14 Sep 2026/)).toBeInTheDocument();
    expect(detectionHint({ kind: "detection", id: `${MAP_RUN_ID}.d1` })).toBe(
      "Reviewing · A accept · X reject · Tab next",
    );
  });

  it("gives no review hint for a reviewed or unloaded detection", () => {
    accepted();
    expect(detectionHint({ kind: "detection", id: `${MAP_RUN_ID}.d1` })).toBeNull();
    expect(detectionHint({ kind: "detection", id: `${MAP_RUN_ID}.zz` })).toBeNull();
  });

  it("A accepts; a defect then opens the finding the event names", async () => {
    const { api, requests } = fakeClient(
      routes([{ method: "POST", path: /\/review$/, body: { updated: 1 } }]),
    );
    render(api);
    await screen.findByText(/machinery-v3/);
    fireEvent.keyDown(window, { key: "a" });
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    useChangesStore.getState().applyEvent({
      type: "findings.changed",
      project_id: "p",
      payload: { ids: ["f5"] },
    } as never);
    await waitFor(() => expect(h.select).toHaveBeenCalledWith({ kind: "finding", id: "f5" }));
  });

  it("a refused reject asks before deleting the finding", async () => {
    accepted();
    const { api } = fakeClient(refusedReject());
    render(api);
    await screen.findByTestId("detection-inspector");
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(await screen.findByTestId("confirm-finding-delete")).toHaveTextContent("Delete finding");
  });

  it("the review keys do nothing while the finding-delete confirm is open", async () => {
    accepted();
    const { api, requests } = fakeClient(refusedReject());
    render(api);
    await screen.findByTestId("detection-inspector");
    fireEvent.keyDown(window, { key: "x" });
    await screen.findByTestId("confirm-finding-delete");
    const posts = () => requests.filter((r) => r.method === "POST").length;
    expect(posts()).toBe(1);
    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(window, { key: "x" });
    await new Promise((r) => setTimeout(r, 20));
    expect(posts()).toBe(1);
  });

  it("offers Open in 3D at the box centre when the survey has a linked cloud", async () => {
    h.open3d.mockReturnValue({
      href: "/p/x/clouds/c1?at=1.000,1.000",
      cloud: {},
    });
    render(fakeClient(routes()).api);
    const button = await screen.findByRole("button", { name: "Open in 3D" });
    await waitFor(() => expect(h.open3d).toHaveBeenCalledWith(1, 1, "2026-09-14"));
    fireEvent.click(button);
    expect(screen.getByTestId("location")).toHaveTextContent("/p/x/clouds/c1?at=1.000,1.000");
  });

  it("hides Open in 3D and gives the reason when there is no cloud", async () => {
    render(fakeClient(routes()).api);
    expect(await screen.findByText("No point cloud is linked to the 2026-09-14 survey.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open in 3D" })).toBeNull();
  });

  it("says so when the detection is not loaded", () => {
    useDetectStore.setState({ byId: new Map() });
    render(fakeClient(routes()).api, `${MAP_RUN_ID}.zz`);
    expect(screen.getByText(/Pan to it on the map, or press Tab/)).toBeInTheDocument();
  });
});
