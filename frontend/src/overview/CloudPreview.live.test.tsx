import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { exampleCloud } from "@/test/cloudFixtures";
import { renderWithProviders } from "@/test/render";
import { CloudPreview } from "./CloudPreview";

// The live branch with the engine stubbed: what the preview does around the viewer, not the viewer.
const h = vi.hoisted(() => ({
  inView: true as boolean | null,
  viewer: "ok" as "ok" | "throw",
  settled: Promise.resolve() as Promise<void>,
}));

vi.mock("./useInView", () => ({ useInView: () => [() => {}, h.inView] }));
vi.mock("@/clouds/CloudViewer", () => ({
  CloudViewer: () => {
    if (h.viewer === "throw") throw new Error("shader compile failed");
    return <div data-testid="live-viewer" />;
  },
}));
vi.mock("@/app/effects", async (orig) => ({
  ...(await orig<object>()),
  autoProbeSettled: () => h.settled,
}));

const region = () => screen.getByRole("region", { name: "Point cloud preview" });

async function renderPreview() {
  const { api, requests } = fakeClient([
    { method: "GET", path: /\/pointclouds$/, body: { items: [exampleCloud] } },
  ]);
  renderWithProviders(<CloudPreview projectId={PROJECT_ID} cloudId={null} variant="hero" />, { api });
  await waitFor(() => expect(requests).toHaveLength(1));
  // Let the list read land and every follow-up microtask run.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("CloudPreview live branch", () => {
  beforeEach(() => {
    delete document.documentElement.dataset.effects;
    h.inView = true;
    h.viewer = "ok";
    h.settled = Promise.resolve();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("mounts the viewer in a box that fills the pane (the viewer's root needs a flex parent)", async () => {
    await renderPreview();
    const viewer = await screen.findByTestId("live-viewer");
    expect(viewer.parentElement).toHaveClass("absolute", "inset-0", "flex");
  });

  it("an engine error falls back to the static card instead of taking the app down", async () => {
    h.viewer = "throw";
    await renderPreview();
    expect(await screen.findByTestId("cloud-static-card")).toBeInTheDocument();
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("live-viewer")).not.toBeInTheDocument();
  });

  it("holds a skeleton, not the static card, until the first intersection callback", async () => {
    h.inView = null;
    await renderPreview();
    expect(region()).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByTestId("cloud-static-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("live-viewer")).not.toBeInTheDocument();
  });

  it("waits for Auto's frame probe to settle before starting the 3D view", async () => {
    let release: () => void = () => {};
    h.settled = new Promise<void>((r) => (release = r));
    await renderPreview();
    expect(screen.queryByTestId("live-viewer")).not.toBeInTheDocument();
    expect(region()).toHaveAttribute("aria-busy", "true");
    await act(async () => release());
    expect(await screen.findByTestId("live-viewer")).toBeInTheDocument();
  });
});
