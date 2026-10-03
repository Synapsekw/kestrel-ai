import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import type { Finding } from "@/api/findings";
import {
  ASSET_FINDING_ID,
  exampleAssetFinding,
  exampleAssetFinding2,
  exampleAssetModel,
  exampleUnplacedAssetFinding,
} from "@/test/assetFindingFixtures";
import { exampleFinding, projectTypes } from "@/test/findingFixtures";
import { fakeClient, PROJECT_ID, SOURCE_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { assetZoneLabels } from "./assetLookups";
import { FindingGallery } from "./FindingGallery";

const types = new Map(projectTypes.map((t) => [t.id, t]));

function gallery(items: Finding[], extra: Partial<Parameters<typeof FindingGallery>[0]> = {}) {
  const onOpen = vi.fn();
  const onEndReached = vi.fn();
  renderWithProviders(
    <FindingGallery
      projectId={PROJECT_ID}
      items={items}
      types={types}
      labels={new Map([[SOURCE_ID, "Flight 14 Sep"]])}
      zoneLabels={assetZoneLabels([exampleAssetModel])}
      activeKey={null}
      loading={false}
      onOpen={onOpen}
      onEndReached={onEndReached}
      {...extra}
    />,
    { api: fakeClient([]).api },
  );
  return { onOpen, onEndReached };
}

describe("FindingGallery", () => {
  it("shows one tile per finding with its thumbnail, number, severity and facts", () => {
    gallery([exampleAssetFinding, exampleUnplacedAssetFinding, exampleFinding]);
    const list = screen.getByRole("list", { name: "Findings gallery" });
    const tile = within(list).getByRole("button", { name: "F-0401 Spalling" });
    expect(within(tile).getByText("Shaft · E · 42.5 m")).toBeInTheDocument();
    expect(tile.querySelector("img")).toHaveAttribute(
      "src",
      expect.stringContaining(`/findings/${ASSET_FINDING_ID}/thumbnail`),
    );
    expect(tile.querySelector("img")).toHaveAttribute("loading", "lazy");
    expect(within(list).getByRole("button", { name: "F-0403 Spalling" })).toHaveTextContent("Unplaced");
    expect(within(list).getByRole("button", { name: "F-0217 Spalling" })).toHaveTextContent("Flight 14 Sep");
  });

  it("opens a finding on click and marks the active one", () => {
    const { onOpen } = gallery([exampleAssetFinding, exampleAssetFinding2], { activeKey: ASSET_FINDING_ID });
    expect(screen.getByRole("button", { name: "F-0401 Spalling" })).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByRole("button", { name: "F-0402 Crack" }));
    expect(onOpen).toHaveBeenCalledWith(exampleAssetFinding2);
  });

  it("renders only the visible rows of a long register", () => {
    const many = Array.from({ length: 600 }, (_, i) => ({ ...exampleAssetFinding, id: `f-${i}`, number: 1000 + i }));
    gallery(many);
    // jsdom: 960 px wide (5 columns), 600 px tall: 3 visible rows plus 2 overscan, at most 25 tiles.
    expect(screen.getAllByRole("listitem").length).toBeLessThanOrEqual(25);
  });

  it("a thumbnail that fails to load shows the type colour outline", () => {
    gallery([exampleAssetFinding]);
    const img = screen.getByRole("button", { name: "F-0401 Spalling" }).querySelector("img")!;
    fireEvent.error(img);
    expect(screen.getByRole("button", { name: "F-0401 Spalling" }).querySelector("img")).toBeNull();
    expect(screen.getByTestId("gallery-thumb-fallback")).toBeInTheDocument();
  });

  it("asks for the next page when the window nears the end, once per length", () => {
    const { onEndReached } = gallery([exampleAssetFinding, exampleAssetFinding2]);
    expect(onEndReached).toHaveBeenCalledTimes(1);
  });
});
