import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { errorBody, fakeClient, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { baseRoutes, exampleFindingDetail, FINDING_ID, TYPE_CRACK } from "@/test/findingFixtures";
import { useChangesStore } from "@/store/changes";
import { useToastStore } from "@/ui";
import { MAP_SEP, UTM38, renderInWorkspace, w3Stores } from "@/mapws/test/w3Fixtures";
import { NO_ORTHO } from "./actions";
import { FindingPointOverlay } from "./FindingOverlay";

const mapGeometry = { type: "Point", coordinates: [583120.4, 3265410.2] };

const anchorOk: FakeRoute = {
  method: "POST",
  path: /\/map-workspace\/anchor$/,
  body: { map_id: MAP_SEP, geometry: mapGeometry, lon: 47.7, lat: 29.4 },
};
const createOk: FakeRoute = {
  method: "POST",
  path: /\/findings$/,
  status: 201,
  body: exampleFindingDetail,
};

function setup(routes: FakeRoute[] = [anchorOk, createOk]) {
  const stores = w3Stores();
  stores.workspace.setState({
    viewApi: { pixelOf: () => [200, 120] } as never,
  });
  const { api, requests } = fakeClient(baseRoutes(routes));
  renderInWorkspace(<FindingPointOverlay projectId={PROJECT_ID} frame={UTM38} />, { stores, api });
  return { stores, requests };
}

const posts = (requests: { method: string; url: string; body: unknown }[]) =>
  requests.filter((r) => r.method === "POST");

const drop = (stores: ReturnType<typeof w3Stores>, at: [number, number]) =>
  act(() =>
    stores.tools.setState({
      completed: { toolId: "finding-point", geometry: { type: "Point", coordinates: at } },
    }),
  );

describe("FindingOverlay", () => {
  beforeEach(() => useToastStore.getState().clear());

  it("a click on the right date's ortho → type picker → F's finding with a map anchor, selected", async () => {
    const { stores, requests } = setup();
    const before = useChangesStore.getState().findingsRevision;
    drop(stores, [500500, 3300500]);
    fireEvent.click(await screen.findByRole("option", { name: /Crack/ }));
    await waitFor(() =>
      expect(stores.workspace.getState().selection).toEqual({
        kind: "finding",
        id: FINDING_ID,
      }),
    );
    expect(posts(requests).map((r) => r.body)).toEqual([
      {
        map_id: MAP_SEP,
        geometry_site: { type: "Point", coordinates: [500500, 3300500] },
      },
      {
        type_id: TYPE_CRACK,
        anchor: { kind: "map", map_id: MAP_SEP, geometry: mapGeometry },
        lon: 47.7,
        lat: 29.4,
      },
    ]);
    expect(stores.tools.getState().completed).toBeNull();
    // A create keeps its trailing bump: the id is unknown before the answer.
    expect(useChangesStore.getState().findingsRevision).toBeGreaterThan(before);
  });

  it("refuses without an ortho and sends nothing", async () => {
    const { stores, requests } = setup();
    drop(stores, [900000, 3300500]);
    await waitFor(() =>
      expect(useToastStore.getState().toasts).toContainEqual(
        expect.objectContaining({ tone: "info", text: NO_ORTHO }),
      ),
    );
    expect(stores.tools.getState().completed).toBeNull();
    expect(posts(requests)).toEqual([]);
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("a server refusal toasts info with the spec's copy and creates nothing (T5a)", async () => {
    const { stores, requests } = setup([
      {
        method: "POST",
        path: /\/map-workspace\/anchor$/,
        status: 422,
        body: errorBody("outside_map", "outside the map's footprint"),
      },
      createOk,
    ]);
    drop(stores, [500500, 3300500]);
    fireEvent.click(await screen.findByRole("option", { name: /Crack/ }));
    await waitFor(() =>
      expect(useToastStore.getState().toasts).toContainEqual(
        expect.objectContaining({ tone: "info", text: NO_ORTHO }),
      ),
    );
    expect(posts(requests).some((r) => r.url.endsWith("/findings"))).toBe(false);
    expect(stores.tools.getState().completed).toBeNull();
    expect(stores.workspace.getState().selection).toBeNull();
  });
});
