import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ComponentType } from "react";
import type { CloudViewOut, GeoMap } from "@contract/client";
import type { CloudMeasurement } from "@/api/cloudMeasurements";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";
import { WorkspaceSeamsContext, type WorkspaceSeams } from "@/clouds/workspace/seams";
import { errorBody, fakeClient, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { baseRoutes, exampleFindingDetail, projectTypes, TYPE_SPALLING } from "@/test/findingFixtures";
import { CLOUD_ID, exampleCloud } from "@/test/cloudFixtures";
import { TestApiProvider } from "@/test/render";
import { FindingDetail, FindingsList, type FindingsTabProps } from "./FindingsTab";
import { FLY_TO_DISTANCE_M } from "./flyTo";
import type { CloudPinsState } from "./useCloudPins";
import type { CloudPin } from "./types";

const types = new Map(projectTypes.map((t) => [t.id, t]));
const pinA: CloudPin = {
  id: "f-a",
  number: 217,
  typeId: TYPE_SPALLING,
  severity: 4,
  status: "open",
  note: "",
  p: [243500.1234, 3178000.5678, 52.0456],
  u: 0.05,
  normal: [0, -1, 0],
};
const pinB: CloudPin = { ...pinA, id: "f-b", number: 218, severity: null, status: "closed", normal: null };

const pose = { position: [243480, 3177980, 70], target: [243500, 3178000, 52], up: [0, 0, 1], fov_deg: 50 };
const viewOf = (id: string, stale = false) =>
  ({ subject_kind: "finding", subject_id: id, pose, stale }) as unknown as CloudViewOut;

function state(pins: CloudPin[], extra: Partial<CloudPinsState> = {}): CloudPinsState {
  return {
    pins,
    views: new Map([["f-a", viewOf("f-a")]]),
    total: pins.length,
    capNote: null,
    status: "ready",
    error: null,
    reload: () => {},
    ...extra,
  };
}

function fakeViewer() {
  return { current: { goToPose: vi.fn(), lookAt: vi.fn() } as unknown as CloudViewerHandle };
}

const measurement = (id: string, findingId: string | null): CloudMeasurement =>
  ({
    id,
    point_cloud_id: CLOUD_ID,
    kind: "distance",
    name: `Distance ${id}`,
    note: null,
    points: [
      { x: 243500, y: 3178000, z: 50, uncertainty_m: 0.05 },
      { x: 243510, y: 3178000, z: 50, uncertainty_m: 0.05 },
    ],
    finding_id: findingId,
  }) as unknown as CloudMeasurement;

function ReportCard({ subject }: { subject: { kind: string; id: string } }) {
  return (
    <p>
      report view of {subject.kind} {subject.id}
    </p>
  );
}
function Likely({ findingId }: { findingId?: string }) {
  return <p>likely views for {findingId}</p>;
}

function mount(
  pins: CloudPinsState,
  opts: {
    selectedId?: string | null;
    routes?: FakeRoute[];
    seams?: Partial<WorkspaceSeams>;
    maps?: GeoMap[];
    /** Which half to render; both by default. */
    only?: "list" | "detail";
  } = {},
) {
  const { api, requests } = fakeClient(
    baseRoutes([
      ...(opts.routes ?? []),
      { method: "GET", path: /\/findings\/f-a$/, body: { ...exampleFindingDetail, id: "f-a", number: 217 } },
      { method: "GET", path: /\/findings\/f-a\/attachments$/, body: { items: [] } },
      { method: "GET", path: /\/findings\/f-a\/comments/, body: { items: [], next_cursor: null } },
      { method: "GET", path: /\/activity/, body: { items: [], next_cursor: null } },
      {
        method: "GET",
        path: /\/pointclouds\/[^/]+\/measurements$/,
        body: { items: [measurement("m-1", "f-a"), measurement("m-2", null)] },
      },
    ]),
  );
  const seams = {
    requestViewCapture: () => {},
    ReportViewCard: null,
    LikelyViews: null,
    ...opts.seams,
  } as WorkspaceSeams;
  const viewer = fakeViewer();
  const onSelect = vi.fn();
  const onMovePin = vi.fn();
  const onNavigate = vi.fn();
  const props: FindingsTabProps = {
    projectId: PROJECT_ID,
    cloud: exampleCloud,
    pins,
    types,
    selectedId: opts.selectedId ?? null,
    onSelect,
    viewer,
    moving: null,
    onMovePin,
    onNavigate,
    maps: opts.maps ?? [],
  };
  const { container } = render(
    <TestApiProvider api={api}>
      <MemoryRouter>
        <WorkspaceSeamsContext.Provider value={seams}>
          {opts.only !== "detail" && <FindingsList {...props} />}
          {opts.only !== "list" && <FindingDetail {...props} />}
        </WorkspaceSeamsContext.Provider>
      </MemoryRouter>
    </TestApiProvider>,
  );
  return { requests, viewer, onSelect, onMovePin, onNavigate, container };
}

describe("FindingsList and FindingDetail", () => {
  it("the list never renders F's inspector, even with a selection", async () => {
    mount(state([pinA, pinB]), { selectedId: "f-a", only: "list" });
    expect(screen.getByRole("list", { name: "Findings on this cloud" })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("cloud-anchor-slot")).toBeNull();
  });

  it("the detail renders F's inspector for the selected finding and no list", async () => {
    mount(state([pinA, pinB]), { selectedId: "f-a", only: "detail" });
    expect(await screen.findByTestId("cloud-anchor-slot")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Findings on this cloud" })).toBeNull();
  });

  it("the detail renders nothing without a selection", () => {
    const { container } = mount(state([pinA, pinB]), { selectedId: null, only: "detail" });
    expect(container).toBeEmptyDOMElement();
  });

  it("lists the cloud's findings with number, location and status", () => {
    mount(state([pinA, pinB]));
    const list = screen.getByRole("list", { name: "Findings on this cloud" });
    const rows = within(list).getAllByRole("button");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("F-0217 · Z 52.0 m · S face");
    expect(rows[1]).toHaveTextContent("F-0218 · Z 52.0 m");
    expect(within(rows[1]).getByRole("img", { name: "Closed" })).toBeInTheDocument();
  });

  it("states the 500-pin cap", () => {
    mount(state([pinA], { capNote: "500 of 812 pins shown", total: 812 }));
    expect(screen.getByText("500 of 812 pins shown")).toBeInTheDocument();
  });

  it("says how to pin the first finding", () => {
    mount(state([]));
    expect(screen.getByText("No findings on this cloud")).toBeInTheDocument();
  });

  it("selects a row, and a second click deselects it", async () => {
    const { onSelect } = mount(state([pinA, pinB]), { selectedId: "f-b" });
    await userEvent.click(screen.getByRole("button", { name: /F-0217/ }));
    expect(onSelect).toHaveBeenLastCalledWith("f-a");
    await userEvent.click(screen.getByRole("button", { name: /F-0218/ }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("opens F's inspector with the position, uncertainty and actions in the anchor slot", async () => {
    const { viewer, onMovePin } = mount(state([pinA]), { selectedId: "f-a" });
    const slot = await screen.findByTestId("cloud-anchor-slot");
    expect(within(slot).getByText("Position · EPSG:32639")).toBeInTheDocument();
    expect(within(slot).getByText("E 243500.123 · N 3178000.568 · Z 52.046")).toBeInTheDocument();
    expect(within(slot).getByText("Uncertainty ±0.05 m")).toBeInTheDocument();
    await userEvent.click(within(slot).getByRole("button", { name: "Fly to" }));
    expect(viewer.current.goToPose).toHaveBeenCalledWith({
      position: [243480, 3177980, 70],
      target: [243500, 3178000, 52],
      up: [0, 0, 1],
      fov_deg: 50,
    });
    await userEvent.click(within(slot).getByRole("button", { name: "Move pin" }));
    expect(onMovePin).toHaveBeenCalledWith("f-a");
  });

  it("flies to the anchor from 20 m when the stored view is stale", async () => {
    const { viewer } = mount(state([pinA], { views: new Map([["f-a", viewOf("f-a", true)]]) }), {
      selectedId: "f-a",
    });
    const slot = await screen.findByTestId("cloud-anchor-slot");
    await userEvent.click(within(slot).getByRole("button", { name: "Fly to" }));
    expect(viewer.current.goToPose).not.toHaveBeenCalled();
    expect(viewer.current.lookAt).toHaveBeenCalledWith(
      { x: pinA.p[0], y: pinA.p[1], z: pinA.p[2] },
      FLY_TO_DISTANCE_M,
    );
  });

  it("renders the report view card and Likely views from the seams", async () => {
    mount(state([pinA]), {
      selectedId: "f-a",
      seams: {
        ReportViewCard: ReportCard as unknown as WorkspaceSeams["ReportViewCard"],
        LikelyViews: Likely as unknown as ComponentType<never> as WorkspaceSeams["LikelyViews"],
      },
    });
    expect(await screen.findByText("report view of finding f-a")).toBeInTheDocument();
    expect(screen.getByText("likely views for f-a")).toBeInTheDocument();
  });

  it("lists only the linked measurements, and Go to looks at their middle", async () => {
    const { viewer } = mount(state([pinA]), { selectedId: "f-a" });
    expect(await screen.findByText("Distance m-1")).toBeInTheDocument();
    expect(screen.queryByText("Distance m-2")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Go to Distance m-1" }));
    expect(viewer.current.lookAt).toHaveBeenCalledWith({ x: 243505, y: 3178000, z: 50 }, FLY_TO_DISTANCE_M);
  });

  it("shows the error when the measurements fail to load, not the empty state", async () => {
    mount(state([pinA]), {
      selectedId: "f-a",
      routes: [
        {
          method: "GET",
          path: /\/pointclouds\/[^/]+\/measurements$/,
          status: 500,
          body: errorBody("server_error", "measurements are unavailable"),
        },
      ],
    });
    expect(await screen.findByText("measurements are unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/No linked measurements/)).toBeNull();
  });

  it("shows no map button without a linked map", async () => {
    mount(state([pinA]), { selectedId: "f-a" });
    await screen.findByTestId("cloud-anchor-slot");
    expect(screen.queryByRole("button", { name: "Show on map" })).toBeNull();
  });
});
