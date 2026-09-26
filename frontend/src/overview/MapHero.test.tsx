import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { MapViewProps } from "@/maps/MapView";
import { useAddData } from "@/app/addDataStore";
import { useChangesStore } from "@/store/changes";
import { errorBody, exampleGeoMap, fakeClient, MAP_ID, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { exampleFinding, severityRoute } from "@/test/findingFixtures";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { MapHero } from "./MapHero";

// OpenLayers needs a canvas; the stub hands MapHero a map whose pixels equal OL coordinates flipped.
vi.mock("@/maps/MapView", () => ({
  MapView: (props: MapViewProps) => {
    useEffect(() => {
      props.onReady?.({ getPixelFromCoordinate: (c: number[]) => [c[0], -c[1]] } as never);
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

function renderHero(heroMapId: string | null, routes: FakeRoute[]) {
  const { api, requests } = fakeClient([severityRoute, ...routes]);
  renderWithProviders(
    <>
      <MapHero projectId={PROJECT_ID} heroMapId={heroMapId} />
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

describe("MapHero", () => {
  beforeEach(() => {
    useAddData.setState({ open: false, tile: null, projectId: null });
    useChangesStore.setState({ findingsRevision: 0 });
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

  it("puts pins on the plain backdrop when there is no map", async () => {
    renderHero(null, [pins]);
    const pin = await screen.findByRole("link", { name: "F-0217 · Critical" });
    expect(pin).toHaveStyle({ left: "50%", top: "50%" });
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
    act(() => {
      useChangesStore.getState().bumpFindings();
      useChangesStore.getState().bumpFindings();
      useChangesStore.getState().bumpFindings();
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(reads()).toBe(1);
    await waitFor(() => expect(reads()).toBe(2), { timeout: 1500 });
    await new Promise((r) => setTimeout(r, 500));
    expect(reads()).toBe(2);
  });
});
