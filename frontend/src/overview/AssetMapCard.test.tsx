import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import {
  ASSET_FINDING_ID,
  ASSET_MODEL_ID,
  exampleAssetFinding,
  exampleAssetFinding2,
  exampleAssetModel,
  examplePhotoReview,
} from "@/test/assetFindingFixtures";
import { errorBody, fakeClient, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { AssetMapCard } from "./AssetMapCard";

vi.mock("@/assetmodels/findingsMap/FindingsMap", () => ({
  FindingsMap: ({ dots, onOpen }: { dots: { id: string }[]; onOpen: (id: string) => void }) => (
    <button
      type="button"
      data-testid="findings-map"
      data-dots={dots.length}
      onClick={() => onOpen(dots[0].id)}
    >
      map
    </button>
  ),
}));

function renderCard(
  model: object = exampleAssetModel,
  findings: FakeRoute["body"] = undefined,
  review = examplePhotoReview,
) {
  const { api } = fakeClient([
    { method: "GET", path: /\/asset-models\/[^/]+$/, body: model },
    {
      method: "GET",
      path: /\/findings$/,
      body: findings ?? { items: [exampleAssetFinding, exampleAssetFinding2], next_cursor: null },
    },
  ]);
  renderWithProviders(
    <>
      <AssetMapCard projectId={PROJECT_ID} modelId={ASSET_MODEL_ID} photoReview={review} />
      <LocationProbe />
    </>,
    { api, route: `/p/${PROJECT_ID}/overview` },
  );
}

describe("AssetMapCard", () => {
  beforeEach(() => useChangesStore.setState({ findingsRevision: 0, dataRevision: 0 }));

  it("draws the model's placed findings and counts them", async () => {
    renderCard();
    const map = await screen.findByTestId("findings-map");
    expect(map).toHaveAttribute("data-dots", "2");
    expect(screen.getByRole("region", { name: "Findings on the asset" })).toHaveTextContent("2 findings");
  });

  it("opens a finding from the map in the Findings tab", async () => {
    renderCard();
    fireEvent.click(await screen.findByTestId("findings-map"));
    expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/findings/${ASSET_FINDING_ID}`);
  });

  it("asks for the frame and review profile when the model has none", async () => {
    renderCard({ ...exampleAssetModel, frame: null });
    expect(
      await screen.findByText("Set the asset frame and review profile to see the findings map."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in Asset models" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/models/${ASSET_MODEL_ID}`,
    );
  });

  it("says so when the findings cannot be read", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/asset-models\/[^/]+$/, body: exampleAssetModel },
      { method: "GET", path: /\/findings$/, status: 500, body: errorBody("internal", "boom") },
    ]);
    renderWithProviders(<AssetMapCard projectId={PROJECT_ID} modelId={ASSET_MODEL_ID} photoReview={null} />, {
      api,
    });
    expect(await screen.findByText("Couldn't load the findings map.")).toBeInTheDocument();
  });

  it("shows the photo outcome bar under the map", async () => {
    renderCard();
    expect(await screen.findByRole("link", { name: "Uncertain: 15 photos" })).toBeInTheDocument();
  });
});
