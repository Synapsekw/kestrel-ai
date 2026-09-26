import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { MapViewProps } from "@/maps/MapView";
import { useAddData } from "@/app/addDataStore";
import { useChangesStore } from "@/store/changes";
import { errorBody, exampleGeoMap, fakeClient, MAP_ID, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { exampleFinding, severityRoute } from "@/test/findingFixtures";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { pushLog } from "@/app/diagnostics";
import { MapHero } from "./MapHero";

// OpenLayers needs a canvas; the stub hands MapHero a map whose pixels equal OL coordinates flipped,
// shifted by `stub.dx` (what a resize does to the screen pixels while the resolution stays put).
const stub = vi.hoisted(() => ({
  dx: 0,
  viewChange: null as MapViewProps["onViewChange"] | null,
}));
vi.mock("@/app/diagnostics", async (orig) => ({ ...(await orig<object>()), pushLog: vi.fn() }));
vi.mock("@/maps/MapView", () => ({
  MapView: (props: MapViewProps) => {
    stub.viewChange = props.onViewChange ?? null;
    useEffect(() => {
      props.onReady?.({ getPixelFromCoordinate: (c: number[]) => [c[0] + stub.dx, -c[1]] } as never);
      props.onViewChange?.({ extent: [0, -1000, 1000, 0], resolution: 2 });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return <div data-testid="map-view" />;
  },
}));

const geo = {
  ...exampleGeoMap,
  width: 1000,
  height: 1000,
  proj4: "+proj=longlat +datum=WGS84 +no_defs",
  geotransform: [47.76, 0.00001, 0, 29.5, 0, -0.00001],
  gsd_cm: 1,
};

function renderHero(heroMapId: string | null, routes: FakeRoute[], hasData = false) {
  const { api, requests } = fakeClient([severityRoute, ...routes]);
  renderWithProviders(
    <>
      <MapHero projectId={PROJECT_ID} heroMapId={heroMapId} hasData={hasData} />
      <LocationProbe />
    </>,
    { api, route: `/p/${PROJECT_ID}/overview` },
  );
  return requests;
}

const pins: FakeRoute = {
  method: "GET",
  path: /\/findings$/,
  body: { items: [exampleFinding], next_cursor: null },
};
const noPins: FakeRoute = { method: "GET", path: /\/findings$/, body: { items: [], next_cursor: null } };
const failedPins: FakeRoute = {
  method: "GET",
  path: /\/findings$/,
  status: 500,
  body: errorBody("internal", "database is locked"),
};

describe("MapHero", () => {
  beforeEach(() => {
    useAddData.setState({ open: false, tile: null, projectId: null });
    useChangesStore.setState({ findingsRevision: 0 });
    stub.dx = 0;
    stub.viewChange = null;
    vi.mocked(pushLog).mockClear();
  });

  it("asks for at most 300 open located findings, most severe first", async () => {
    const requests = renderHero(null, [pins]);
    await screen.findByRole("link", { name: /F-0217/ });
    const q = new URL(requests.find((r) => r.url.includes("/findings"))!.url, "http://fake").searchParams;
    expect(q.get("has_location")).toBe("true");
    expect(q.getAll("status")).toEqual(["open"]);
    expect(q.get("sort")).toBe("-severity");
    expect(q.get("limit")).toBe("300");
  });

  it("places pins on the newest map and opens the Maps tab on click", async () => {
    renderHero(MAP_ID, [pins, { method: "GET", path: /\/maps\/[^/]+$/, body: geo }]);
    expect(await screen.findByTestId("map-view")).toBeInTheDocument();
    const pin = await screen.findByRole("link", { name: "F-0217 · Critical" });
    expect(pin).toHaveStyle({ left: "500px", top: "500px" });
    expect(pin).toHaveAttribute("href", `/p/${PROJECT_ID}/findings/${exampleFinding.id}`);
    // resolution 2 × GSD 1 cm = 2 cm per screen pixel: the longest round length under 120 px is 2 m.
    expect(screen.getByTestId("hero-scale")).toHaveTextContent("2 m");
    fireEvent.click(screen.getByRole("button", { name: "Open the Maps tab" }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/maps?map=${MAP_ID}`),
    );
  });

  it("moves the pins when a resize shifts the view at the same resolution", async () => {
    renderHero(MAP_ID, [pins, { method: "GET", path: /\/maps\/[^/]+$/, body: geo }]);
    const pin = await screen.findByRole("link", { name: "F-0217 · Critical" });
    expect(pin).toHaveStyle({ left: "500px", top: "500px" });
    act(() => {
      stub.dx = 100;
      stub.viewChange?.({ extent: [-100, -1000, 1100, 0], resolution: 2 });
    });
    expect(screen.getByRole("link", { name: "F-0217 · Critical" })).toHaveStyle({
      left: "600px",
      top: "500px",
    });
  });

  it("puts pins on the plain backdrop when there is no map", async () => {
    renderHero(null, [pins]);
    const pin = await screen.findByRole("link", { name: "F-0217 · Critical" });
    expect(pin).toHaveStyle({ left: "50%", top: "50%" });
    // The most severe level gets the thicker ring (DESIGN.md), from the scale's top level.
    expect(pin).toHaveClass("border-[3px]");
    expect(screen.queryByTestId("map-view")).toBeNull();
    expect(screen.getByTestId("hero-scale")).toHaveTextContent(/\d+ (m|km)$/);
  });

  it("falls back to the backdrop when the map cannot be read", async () => {
    renderHero(MAP_ID, [
      pins,
      { method: "GET", path: /\/maps\/[^/]+$/, status: 404, body: errorBody("not_found", "gone") },
    ]);
    const pin = await screen.findByRole("link", { name: "F-0217 · Critical" });
    expect(pin).toHaveStyle({ left: "50%" });
  });

  it("asks for data when there is neither a map nor a located finding", async () => {
    useAddData.setState({ projectId: PROJECT_ID });
    renderHero(null, [noPins]);
    fireEvent.click(await screen.findByRole("button", { name: "Add data" }));
    expect(useAddData.getState().open).toBe(true);
  });

  it("says quietly that no open finding has a location when the project has data", async () => {
    renderHero(null, [noPins], true);
    expect(await screen.findByText("No open findings with a location")).toBeInTheDocument();
    expect(screen.queryByText("Start by adding data")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add data" })).toBeNull();
  });

  it("says the pins could not be loaded instead of asking for data", async () => {
    renderHero(null, [failedPins], true);
    expect(await screen.findByText("The finding pins could not be loaded")).toBeInTheDocument();
    expect(screen.queryByText("No open findings with a location")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add data" })).toBeNull();
  });

  it("keeps the pins on screen when a refresh fails", async () => {
    let fail = false;
    renderHero(null, [
      {
        method: "GET",
        path: /\/findings$/,
        status: () => (fail ? 500 : 200),
        body: () =>
          fail ? errorBody("internal", "database is locked") : { items: [exampleFinding], next_cursor: null },
      },
    ]);
    await screen.findByRole("link", { name: "F-0217 · Critical" });
    fail = true;
    act(() => useChangesStore.getState().bumpFindings());
    await waitFor(
      () => expect(pushLog).toHaveBeenCalledWith(expect.stringMatching(/hero pins unavailable/)),
      {
        timeout: 2000,
      },
    );
    expect(screen.getByRole("link", { name: "F-0217 · Critical" })).toBeInTheDocument();
  });

  it("keeps Add data disabled while the project is still loading", async () => {
    renderHero(null, [noPins]);
    const button = await screen.findByRole("button", { name: "Add data" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(useAddData.getState().open).toBe(false);
  });

  it("re-reads the pins once per burst of findings changes", async () => {
    const requests = renderHero(null, [pins]);
    await screen.findByRole("link", { name: /F-0217/ });
    const reads = () => requests.filter((r) => r.url.includes("/findings")).length;
    expect(reads()).toBe(1);
    // Fake timers: only the test moves the clock, so a stalled runner cannot split the burst.
    vi.useFakeTimers();
    try {
      act(() => {
        useChangesStore.getState().bumpFindings();
        useChangesStore.getState().bumpFindings();
        useChangesStore.getState().bumpFindings();
      });
      await act(() => vi.advanceTimersByTimeAsync(399));
      expect(reads()).toBe(1);
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(reads()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
