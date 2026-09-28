import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import type { MapFindingPin } from "@/api/mapFindings";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import {
  DSM_SEP,
  LAYERS,
  MAP_SEP,
  UTM38,
  renderInWorkspace,
  seedLayers,
  w3Stores,
} from "@/mapws/test/w3Fixtures";
import type { WorkspaceLayer } from "@/mapws/annotations/bindings";
import { FindingMeasure } from "./FindingMeasure";
import { useMapFindingsStore } from "./store";

const FID = "f0000000-9999-4000-8000-000000000031";
const pin = (geometry_site: unknown) =>
  ({
    id: FID,
    number: 31,
    type_id: "t",
    severity: 3,
    status: "open",
    created_by: "human",
    map_id: MAP_SEP,
    geometry_site,
  }) as MapFindingPin;

function renderSlot(opts: { routes?: ReturnType<typeof fakeClient>; layers?: WorkspaceLayer[] } = {}) {
  const stores = w3Stores();
  if (opts.layers) seedLayers(stores, opts.layers);
  const routes = opts.routes ?? fakeClient([]);
  renderInWorkspace(
    <FindingMeasure selection={{ kind: "finding", id: FID }} projectId={PROJECT_ID} frame={UTM38} />,
    { stores, api: routes.api },
  );
  return routes.requests;
}

describe("the finding.measure slot (W3-4)", () => {
  beforeEach(() => {
    useMapFindingsStore.setState({ bySide: {}, byId: {}, truncatedBySide: {}, truncated: false });
  });

  it("a polygon finding shows its approximate grid area", () => {
    const ring = [
      [0, 0],
      [200, 0],
      [200, 200],
      [0, 200],
      [0, 0],
    ];
    useMapFindingsStore.getState().setSide("single", [pin({ type: "Polygon", coordinates: [ring] })], false);
    renderSlot();
    expect(screen.getByText("≈ 40 000 m²")).toBeInTheDocument();
    expect(screen.getByText("grid")).toBeInTheDocument();
  });

  it("a point finding shows the height of the right date's DSM", async () => {
    useMapFindingsStore
      .getState()
      .setSide("single", [pin({ type: "Point", coordinates: [500500, 3300500] })], false);
    const requests = renderSlot({
      routes: fakeClient([
        {
          method: "POST",
          path: /\/map-workspace\/sample$/,
          body: { x: 500500, y: 3300500, samples: [{ surface_id: DSM_SEP, z: 612.346 }] },
        },
      ]),
    });
    expect(await screen.findByText("612.35 m")).toBeInTheDocument();
    expect(screen.getByText("DSM 14 Sep")).toBeInTheDocument();
    expect(requests[0].body).toEqual({ x: 500500, y: 3300500, surface_ids: [DSM_SEP] });
    expect(requests).toHaveLength(1);
  });

  it("says so when the right date has no DSM", async () => {
    useMapFindingsStore
      .getState()
      .setSide("single", [pin({ type: "Point", coordinates: [500500, 3300500] })], false);
    const requests = renderSlot({ layers: LAYERS.filter((l) => l.id !== DSM_SEP) });
    await waitFor(() => expect(screen.getByText("No elevation layer here")).toBeInTheDocument());
    expect(requests).toHaveLength(0);
  });

  it("shows '–' for a pin outside the current view (preflight P12: no stuck skeleton)", () => {
    renderSlot();
    expect(screen.getByText("–")).toBeInTheDocument();
  });
});
