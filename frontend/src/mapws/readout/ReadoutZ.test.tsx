import { act, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PROJECT_ID, fakeClient } from "@/test/fixtures";
import { makeStores, renderInWorkspace } from "../test/harness";
import { UTM33, survey } from "../test/fixtures";
import { layerFeed, surfaceLayer } from "../test/rasterFixtures";
import { ReadoutZ } from "./ReadoutZ";

vi.mock("../data/useWorkspaceLayers", async (importOriginal) => {
  const { layerFeed } = await import("../test/rasterFixtures");
  return {
    ...(await importOriginal<typeof import("../data/useWorkspaceLayers")>()),
    useWorkspaceLayers: () => layerFeed,
  };
});

function setup() {
  Object.assign(layerFeed, {
    loading: false,
    layers: [surfaceLayer("dsm", "2026-09-14"), surfaceLayer("design", null, "design")],
  });
  const { api, requests } = fakeClient(
    [
      {
        method: "POST",
        path: /\/map-workspace\/sample$/,
        body: { samples: [{ surface_id: "dsm", z: 612.345 }] },
      },
    ],
    { signalSafe: true },
  );
  const stores = makeStores({
    surveys: [survey("2026-08-14"), survey("2026-09-14")],
  });
  act(() => {
    stores.workspace.getState().setLayerState("surface:dsm", { visible: true });
    stores.workspace.getState().setLayerState("surface:design", { visible: true });
  });
  renderInWorkspace(<ReadoutZ projectId={PROJECT_ID} frame={UTM33} />, {
    stores,
    api,
  });
  return { ws: stores.workspace, requests };
}

describe("ReadoutZ (M §5 Coordinates, W2-5)", () => {
  it("samples the r-dated visible elevation under the cursor, in teal mono", async () => {
    const { ws, requests } = setup();
    expect(await screen.findByTestId("readout-z")).toHaveTextContent("Z —");
    act(() => ws.getState().setPointer([500100, 4982000]));
    expect(await screen.findByText("Z 612.35 m")).toHaveClass("text-ok");
    expect(requests[0].body).toEqual({
      x: 500100,
      y: 4982000,
      surface_ids: ["dsm"],
    });
  });

  it("hides without a visible elevation row of r; a design never counts", async () => {
    const { ws } = setup();
    await screen.findByTestId("readout-z");
    act(() => ws.getState().setLayerState("surface:dsm", { visible: false }));
    expect(screen.queryByTestId("readout-z")).toBeNull();
  });
});
