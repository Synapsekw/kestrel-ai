import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { ASSET_MODEL_ID, exampleAssetModel } from "@/test/assetFindingFixtures";
import { errorBody, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { AssetPreview } from "./AssetPreview";

vi.mock("./useInView", () => ({ useInView: () => [() => {}, true] }));

function renderPreview(model: object | null = exampleAssetModel, status = 200) {
  const { api } = fakeClient([
    {
      method: "GET",
      path: /\/asset-models\/[^/]+$/,
      status,
      body: status === 200 ? (model ?? {}) : errorBody("internal", "boom"),
    },
  ]);
  renderWithProviders(<AssetPreview projectId={PROJECT_ID} modelId={ASSET_MODEL_ID} />, { api });
}

describe("AssetPreview", () => {
  beforeEach(() => {
    delete document.documentElement.dataset.effects;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("shows the static card, not an error, when WebGL cannot start (jsdom has none)", async () => {
    renderPreview();
    // The real viewer chunk (three) loads first; that import is slow in jsdom.
    await waitFor(() => expect(screen.getByTestId("asset-static-card")).toBeInTheDocument(), {
      timeout: 5000,
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("asset-static-card")).toHaveTextContent("Flare stack F-1");
    expect(screen.getByTestId("asset-static-card")).toHaveTextContent("F-1 · 80.0 m · v2");
    expect(screen.getByRole("link", { name: "Open in Asset models" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/models/${ASSET_MODEL_ID}`,
    );
  });

  it("never starts the 3D view under reduced effects", async () => {
    document.documentElement.dataset.effects = "reduced";
    renderPreview();
    await waitFor(() => expect(screen.getByTestId("asset-static-card")).toBeInTheDocument());
    expect(screen.queryByTestId("model-canvas")).not.toBeInTheDocument();
  });

  it("says the model is still being built when it has no version", async () => {
    renderPreview({ ...exampleAssetModel, current_version: null, status: "building" });
    expect(await screen.findByText("The asset model is still being built.")).toBeInTheDocument();
  });

  it("says the preview could not be loaded when the read fails, with a way to Asset models", async () => {
    renderPreview(null, 500);
    expect(await screen.findByText("Couldn't load the asset preview.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Asset models" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/models/${ASSET_MODEL_ID}`,
    );
  });
});
