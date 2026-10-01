import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { errorBody, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { exampleCloud } from "@/test/cloudFixtures";
import { renderWithProviders } from "@/test/render";
import { CloudPreview } from "./CloudPreview";

vi.mock("./useInView", () => ({ useInView: () => [() => {}, true] }));

function renderPreview(variant: "hero" | "tile" = "tile") {
  const { api } = fakeClient([{ method: "GET", path: /\/pointclouds$/, body: { items: [exampleCloud] } }]);
  renderWithProviders(<CloudPreview projectId={PROJECT_ID} cloudId={null} variant={variant} />, { api });
}

describe("CloudPreview", () => {
  beforeEach(() => {
    delete document.documentElement.dataset.effects;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("shows a static card, not an error, when WebGL cannot start (jsdom has none)", async () => {
    renderPreview();
    // The real viewer chunk (three + potree-core) loads first; that import is slow in jsdom.
    await waitFor(() => expect(screen.getByTestId("cloud-static-card")).toBeInTheDocument(), {
      timeout: 5000,
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("cloud-static-card")).toHaveTextContent(/M points · 2026-05-04/);
    expect(screen.getByRole("link", { name: /open in point clouds/i })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/clouds/${exampleCloud.id}`,
    );
  });

  it("never starts the 3D view under reduced effects", async () => {
    document.documentElement.dataset.effects = "reduced";
    renderPreview("hero");
    await waitFor(() => expect(screen.getByTestId("cloud-static-card")).toBeInTheDocument());
    expect(screen.queryByTestId("cloud-canvas")).not.toBeInTheDocument();
  });

  it("says the cloud is being prepared when none is ready, never an empty pane", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/pointclouds$/, body: { items: [{ ...exampleCloud, status: "importing" }] } },
    ]);
    renderWithProviders(<CloudPreview projectId={PROJECT_ID} cloudId={null} variant="tile" />, { api });
    await waitFor(() =>
      expect(screen.getByText("The point cloud is still being prepared.")).toBeInTheDocument(),
    );
  });

  it("says the preview could not be loaded when the list read fails, with a way to Point clouds", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/pointclouds$/, status: 500, body: errorBody("internal", "boom") },
    ]);
    renderWithProviders(<CloudPreview projectId={PROJECT_ID} cloudId={null} variant="tile" />, { api });
    expect(await screen.findByText("Couldn't load the point cloud preview.")).toBeInTheDocument();
    expect(screen.queryByText(/still being prepared/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /point clouds/i })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/clouds`,
    );
  });

  it("says the import failed when the only clouds failed, with a way to Point clouds", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/pointclouds$/, body: { items: [{ ...exampleCloud, status: "failed" }] } },
    ]);
    renderWithProviders(<CloudPreview projectId={PROJECT_ID} cloudId={null} variant="tile" />, { api });
    expect(await screen.findByText("The point cloud import failed.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /point clouds/i })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/clouds`,
    );
  });
});
