import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useParams } from "react-router-dom";
import type { CloudViewOut } from "@contract/client";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";
import type { Finding } from "@/api/findings";
import { errorBody, fakeClient, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { exampleFinding, exampleFindingDetail } from "@/test/findingFixtures";
import { CLOUD_ID } from "@/test/cloudFixtures";
import { LocationProbe, TestApiProvider } from "@/test/render";
import { useToastStore } from "@/ui";
import { FLY_TO_DISTANCE_M } from "./flyTo";
import { useFindingArrival } from "./useFindingArrival";
import type { CloudPinsState } from "./useCloudPins";

const OTHER = "c0000000-8888-4000-8000-000000000002";
const cloudAnchor = (cloudId: string) =>
  ({
    kind: "cloud",
    cloud_id: cloudId,
    x: 243500,
    y: 3178000,
    z: 52,
    uncertainty_m: 0.05,
  }) as Finding["anchor"];
const detail = (anchor: Finding["anchor"]) => ({ ...exampleFindingDetail, id: "f-1", anchor });

function pinsState(views: [string, CloudViewOut][] = []): CloudPinsState {
  return {
    pins: [],
    views: new Map(views),
    total: 0,
    capNote: null,
    status: "ready",
    error: null,
    reload: () => {},
  };
}

function Harness(props: {
  viewer: { current: CloudViewerHandle | null };
  pins: CloudPinsState;
  onArrive: (id: string) => void;
}) {
  const { cloudId } = useParams();
  const { search } = useLocation();
  useFindingArrival({
    projectId: PROJECT_ID,
    routeCloudId: cloudId,
    search,
    viewer: props.viewer,
    pins: props.pins,
    onArrive: props.onArrive,
  });
  return <LocationProbe />;
}

function mount(route: FakeRoute, url: string, pins = pinsState()) {
  const { api, requests } = fakeClient([route]);
  let points = 0;
  const viewer = {
    current: {
      stats: () => ({ numVisiblePoints: points }),
      goToPose: vi.fn(),
      lookAt: vi.fn(),
    } as unknown as CloudViewerHandle,
  };
  const onArrive = vi.fn();
  render(
    <TestApiProvider api={api}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route
            path="/p/:projectId/clouds/:cloudId?"
            element={<Harness viewer={viewer} pins={pins} onArrive={onArrive} />}
          />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </TestApiProvider>,
  );
  return { requests, viewer, onArrive, showPoints: () => (points = 1000) };
}

const findingRoute = (body: object, status = 200): FakeRoute => ({
  method: "GET",
  path: /\/findings\/f-1$/,
  status,
  body,
});
const location = () => screen.getByTestId("location").textContent;

describe("useFindingArrival", () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }));

  it("selects the finding at once, then flies to its stored view when points show", async () => {
    const pose = {
      position: [243480, 3177980, 70],
      target: [243500, 3178000, 52],
      up: [0, 0, 1],
      fov_deg: 50,
    };
    const view = {
      subject_kind: "finding",
      subject_id: "f-1",
      pose,
      stale: false,
    } as unknown as CloudViewOut;
    const m = mount(
      findingRoute(detail(cloudAnchor(CLOUD_ID))),
      `/p/${PROJECT_ID}/clouds/${CLOUD_ID}?finding=f-1`,
      pinsState([["f-1", view]]),
    );
    await waitFor(() =>
      expect(m.onArrive).toHaveBeenCalledWith("f-1", expect.objectContaining({ id: "f-1" })),
    );
    expect(m.viewer.current!.goToPose).not.toHaveBeenCalled();
    m.showPoints();
    await waitFor(() => expect(m.viewer.current!.goToPose).toHaveBeenCalledTimes(1));
  });

  it("looks at the anchor from 20 m without a stored view", async () => {
    const m = mount(
      findingRoute(detail(cloudAnchor(CLOUD_ID))),
      `/p/${PROJECT_ID}/clouds/${CLOUD_ID}?finding=f-1`,
    );
    m.showPoints();
    await waitFor(() =>
      expect(m.viewer.current!.lookAt).toHaveBeenCalledWith(
        { x: 243500, y: 3178000, z: 52 },
        FLY_TO_DISTANCE_M,
      ),
    );
  });

  it("redirects to the cloud the anchor names, then arrives there", async () => {
    const m = mount(
      findingRoute(detail(cloudAnchor(OTHER))),
      `/p/${PROJECT_ID}/clouds/${CLOUD_ID}?finding=f-1`,
    );
    await waitFor(() => expect(location()).toBe(`/p/${PROJECT_ID}/clouds/${OTHER}?finding=f-1`));
    // the same route now names the anchor's cloud: the hook reads the finding again and selects it
    await waitFor(() =>
      expect(m.onArrive).toHaveBeenCalledWith("f-1", expect.objectContaining({ id: "f-1" })),
    );
    expect(m.requests.filter((r) => r.method === "GET")).toHaveLength(2);
  });

  it("redirects an image finding to F's workspace link", async () => {
    mount(findingRoute(detail(exampleFinding.anchor)), `/p/${PROJECT_ID}/clouds/${CLOUD_ID}?finding=f-1`);
    await waitFor(() => expect(location()).toMatch(new RegExp(`^/p/${PROJECT_ID}/images/.+\\?finding=f-1$`)));
  });

  it("says so when the finding is gone, without navigating", async () => {
    const m = mount(
      findingRoute(errorBody("not_found", "finding not found"), 404),
      `/p/${PROJECT_ID}/clouds/${CLOUD_ID}?finding=f-1`,
    );
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.text)).toContain("This finding no longer exists"),
    );
    expect(location()).toBe(`/p/${PROJECT_ID}/clouds/${CLOUD_ID}?finding=f-1`);
    expect(m.onArrive).not.toHaveBeenCalled();
  });

  it("does nothing without ?finding=", async () => {
    const m = mount(
      findingRoute(detail(cloudAnchor(CLOUD_ID))),
      `/p/${PROJECT_ID}/clouds/${CLOUD_ID}?at=1,2`,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(m.requests).toHaveLength(0);
  });
});
