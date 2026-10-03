import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { exampleAssetFinding, exampleAssetFinding2, exampleAssetModel } from "@/test/assetFindingFixtures";
import { FindingsMap } from "./FindingsMap";
import { toMapDot } from "./useAssetMapDots";

// P1's real geometry: the component and the TS twin fit together.
describe("FindingsMap with the shared geometry", () => {
  it("draws a silhouette and both placed findings of the example stack", () => {
    const dots = [toMapDot(exampleAssetFinding)!, toMapDot(exampleAssetFinding2)!];
    render(
      <FindingsMap
        review={exampleAssetModel.review!}
        frame={exampleAssetModel.frame!}
        dots={dots}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByTestId("silhouette").getAttribute("d")).toMatch(/^M/);
    expect(screen.getAllByTestId("map-dot")).toHaveLength(2);
    expect(screen.getAllByTestId("zone-band")).toHaveLength(3);
  });
});
