import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECT_ID, fakeClient } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useWorkspace } from "../context";
import { MapWorkspace } from "../MapWorkspace";
import { LOCAL, UTM33, layer } from "../test/fixtures";
import { WS, fakeView, workspaceRoutes } from "../test/workspaceScreen";

/** Like the real SiteMap: every mount (one per frame, keyed by siteCode) publishes a new view API. */
function FreshViewSiteMap() {
  const setViewApi = useWorkspace((s) => s.setViewApi);
  useEffect(() => {
    setViewApi({ ...fakeView });
    return () => setViewApi(null);
  }, [setViewApi]);
  return <div data-testid="site-map" />;
}

vi.mock("../view/SiteMap", () => ({ SiteMap: FreshViewSiteMap }));

beforeEach(() => fakeView.fit.mockClear());

describe("FrameSwitch inside the workspace", () => {
  it("reads frame_items from GET /map-workspace into the coordinates panel", async () => {
    const { api } = fakeClient(workspaceRoutes({ ws: { ...WS, frame_items: { crs: 3, local: 2 } } }));
    renderWithProviders(<MapWorkspace />, {
      api,
      route: `/p/${PROJECT_ID}/maps`,
      path: "/p/:projectId/maps",
    });
    const button = await screen.findByRole("button", { name: "Local metres · 2 surfaces" });
    expect(screen.getByTestId("coord-readout")).toContainElement(button);
  });

  it("fits the new frame's site after a switch, not the saved view in the old frame's coordinates", async () => {
    let frame = UTM33;
    const saved = { v: 1, view: { center: [501200, 4982100], resolution: 0.5, rotation: 0 } };
    const localExtent = [0, 0, 120, 80];
    const { api } = fakeClient([
      { method: "PUT", path: /\/map-workspace\/frame$/, body: () => ((frame = LOCAL), {}) },
      ...workspaceRoutes({
        ws: () => ({ ...WS, frame, state: saved, frame_items: { crs: 1, local: 1 } }),
        layers: () => ({
          frame,
          items:
            frame.kind === "local"
              ? [layer("surface", "s-1", { footprint_site: localExtent })]
              : [layer("map", "m-1")],
        }),
      }),
    ]);
    renderWithProviders(<MapWorkspace />, {
      api,
      route: `/p/${PROJECT_ID}/maps`,
      path: "/p/:projectId/maps",
    });
    fireEvent.click(await screen.findByRole("button", { name: "Local metres · 1 surface" }));
    await screen.findByRole("button", { name: "Site CRS · 1 item" });
    await waitFor(() => expect(fakeView.fit).toHaveBeenCalledWith(localExtent));
    expect(fakeView.fit).toHaveBeenCalledTimes(1);
  });
});
