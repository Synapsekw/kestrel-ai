import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { ASSET_MODEL_ID, exampleAssetModel } from "@/test/assetFindingFixtures";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { AssetPreview } from "./AssetPreview";

// The live branch with the viewer stubbed: what the preview does around the viewer, not the viewer.
const h = vi.hoisted(() => ({
  inView: true as boolean | null,
  state: "running" as string,
  rotate: vi.fn(),
  settled: Promise.resolve() as Promise<void>,
}));

vi.mock("./useInView", () => ({ useInView: () => [() => {}, h.inView] }));
vi.mock("@/app/effects", async (orig) => ({
  ...(await orig<object>()),
  autoProbeSettled: () => h.settled,
}));
vi.mock("@/assetmodels/viewer/ModelViewer", async () => {
  const { forwardRef, useEffect, useImperativeHandle } = await import("react");
  return {
    ModelViewer: forwardRef(function Stub(
      props: { glbUrl: string | null; onState?: (s: string) => void },
      ref,
    ) {
      useImperativeHandle(ref, () => ({ setAutoRotate: h.rotate }), []);
      useEffect(() => props.onState?.(h.state));
      if (h.state === "throw") throw new Error("shader compile failed");
      return <div data-testid="live-viewer" data-glb={props.glbUrl ?? ""} />;
    }),
  };
});

const region = () => screen.getByRole("region", { name: "Asset preview" });

async function renderPreview() {
  const { api, requests } = fakeClient([
    { method: "GET", path: /\/asset-models\/[^/]+$/, body: exampleAssetModel },
  ]);
  renderWithProviders(<AssetPreview projectId={PROJECT_ID} modelId={ASSET_MODEL_ID} />, { api });
  await waitFor(() => expect(requests).toHaveLength(1));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("AssetPreview live branch", () => {
  beforeEach(() => {
    delete document.documentElement.dataset.effects;
    h.inView = true;
    h.state = "running";
    h.rotate.mockReset();
    h.settled = Promise.resolve();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("loads the current version's GLB and turns auto-rotate on once it runs", async () => {
    await renderPreview();
    const viewer = await screen.findByTestId("live-viewer");
    expect(viewer.dataset.glb).toContain(`/asset-models/${ASSET_MODEL_ID}/versions/2/glb`);
    expect(h.rotate).toHaveBeenCalledWith(true);
    expect(region()).toHaveAttribute("data-rotating", "true");
    expect(viewer.parentElement).toHaveClass("absolute", "inset-0", "flex");
  });

  it("a load error falls back to the static card", async () => {
    h.state = "load-error";
    await renderPreview();
    expect(await screen.findByTestId("asset-static-card")).toBeInTheDocument();
    expect(h.rotate).not.toHaveBeenCalled();
  });

  it("an engine error falls back to the static card instead of taking the app down", async () => {
    h.state = "throw";
    await renderPreview();
    expect(await screen.findByTestId("asset-static-card")).toBeInTheDocument();
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });

  it("holds a skeleton until the first intersection callback", async () => {
    h.inView = null;
    await renderPreview();
    expect(region()).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByTestId("live-viewer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("asset-static-card")).not.toBeInTheDocument();
  });

  it("waits for Auto's frame probe to settle before starting the 3D view", async () => {
    let release: () => void = () => {};
    h.settled = new Promise<void>((r) => (release = r));
    await renderPreview();
    expect(screen.queryByTestId("live-viewer")).not.toBeInTheDocument();
    await act(async () => release());
    expect(await screen.findByTestId("live-viewer")).toBeInTheDocument();
  });
});
