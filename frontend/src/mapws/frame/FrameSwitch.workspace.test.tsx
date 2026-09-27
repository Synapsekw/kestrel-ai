import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PROJECT_ID, fakeClient } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { MapWorkspace } from "../MapWorkspace";
import { WS, workspaceRoutes } from "../test/workspaceScreen";

vi.mock("../view/SiteMap", async () => ({
  SiteMap: (await import("../test/workspaceScreen")).FakeSiteMap,
}));

describe("FrameSwitch inside the workspace", () => {
  it("reads frame_items from GET /map-workspace into the coordinates panel", async () => {
    const { api } = fakeClient(workspaceRoutes({ ws: { ...WS, frame_items: { crs: 3, local: 2 } } }));
    renderWithProviders(<MapWorkspace />, {
      api,
      route: `/p/${PROJECT_ID}/maps`,
      path: "/p/:projectId/maps",
    });
    const button = await screen.findByRole("button", { name: "Local metres · 2 items" });
    expect(screen.getByTestId("coord-readout")).toContainElement(button);
  });
});
