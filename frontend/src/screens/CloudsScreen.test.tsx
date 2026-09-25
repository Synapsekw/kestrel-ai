import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { CLOUD_ID, exampleCloud } from "@/test/cloudFixtures";
import { renderWithProviders } from "@/test/render";
import { CloudsScreen } from "./CloudsScreen";

// The viewer needs WebGL; the screen's own behaviour is tested around a stand-in.
// A forwardRef stand-in, because the screen hands the viewer a ref.
vi.mock("@/clouds/CloudViewer", async () => {
  const { forwardRef } = await import("react");
  return {
    CloudViewer: forwardRef(function CloudViewer() {
      return <div data-testid="cloud-viewer" />;
    }),
  };
});

const routes = (items: object[]) => [
  { method: "GET", path: /\/pointclouds$/, body: { items } },
  { method: "GET", path: new RegExp(`/pointclouds/${CLOUD_ID}$`), body: items[0] ?? null },
  { method: "GET", path: /\/maps$/, body: { items: [] } },
];

describe("Clouds screen", () => {
  it("invites an import when there are no clouds", async () => {
    const { api } = fakeClient(routes([]));
    renderWithProviders(<CloudsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/clouds`,
      path: "/p/:projectId/clouds",
    });
    expect(await screen.findByText("Import a LAS or LAZ point cloud")).toBeInTheDocument();
  });

  it("lists clouds with their facts and a failed one with its reason", async () => {
    const failed = {
      ...exampleCloud,
      id: "c2",
      name: "Broken",
      status: "failed",
      error: "the file has no points",
      point_count: null,
    };
    const { api } = fakeClient(routes([exampleCloud, failed]));
    renderWithProviders(<CloudsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/clouds`,
      path: "/p/:projectId/clouds",
    });
    const list = await screen.findByRole("list", { name: "Point clouds" });
    expect(list).toHaveTextContent("21.7 M points");
    expect(list).toHaveTextContent("EPSG:32639");
    expect(list).toHaveTextContent("738 MB");
    expect(screen.getByText("the file has no points")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import again" })).toBeInTheDocument();
  });

  it("shows Details, and View with RGB disabled for a cloud without colour", async () => {
    const grey = { ...exampleCloud, has_rgb: false };
    const { api } = fakeClient(routes([grey]));
    renderWithProviders(<CloudsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/clouds/${CLOUD_ID}`,
      path: "/p/:projectId/clouds/:cloudId",
    });
    const panel = await screen.findByTestId("cloud-panel");
    expect(panel).toHaveTextContent(/Header bounds repaired/);
    expect(panel).toHaveTextContent("as stored, no vertical datum");
    await userEvent.click(screen.getByRole("radio", { name: "View" }));
    expect(screen.getByRole("radio", { name: "RGB" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Elevation" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Lowest")).toHaveValue(-44);
    expect(screen.getByLabelText("Highest")).toHaveValue(170);
  });

  it("offers Assign CRS only when the cloud has no coordinates", async () => {
    const bare = { ...exampleCloud, crs_wkt: null, epsg: null, proj4: null, bounds_wgs84: null };
    const { api } = fakeClient(routes([bare]));
    renderWithProviders(<CloudsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/clouds/${CLOUD_ID}`,
      path: "/p/:projectId/clouds/:cloudId",
    });
    expect(await screen.findByLabelText("EPSG code")).toBeInTheDocument();
  });
});
