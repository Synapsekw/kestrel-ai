import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { LAYERS, renderInWorkspace, w3Stores } from "@/mapws/test/w3Fixtures";
import { completedCoords, isShown, useSiteLayers } from "./bindings";

/** Reads `useSiteLayers()` and prints the ids so the test can assert on rendered text. */
function LayerIds() {
  const layers = useSiteLayers();
  return <output data-testid="ids">{layers.map((l) => l.id).join(",")}</output>;
}

describe("W3's bindings to W1", () => {
  it("reads the layers W1's workspace store has loaded", () => {
    const stores = w3Stores({ layers: LAYERS.slice(0, 1) });
    renderInWorkspace(<LayerIds />, { stores });
    expect(screen.getByTestId("ids").textContent).toBe(LAYERS[0].id);
  });

  it("a row is shown unless its layer state hides it", () => {
    const l = { kind: "map", id: "m1" };
    expect(isShown(l, {})).toBe(true);
    expect(isShown(l, { "map:m1": { visible: false } })).toBe(false);
    expect(isShown(l, { "map:m1": { visible: true } })).toBe(true);
  });

  it("turns W1's completed geometry into vertices (a polygon ring opened)", () => {
    expect(completedCoords({ type: "Point", coordinates: [1, 2] })).toEqual([[1, 2]]);
    expect(
      completedCoords({
        type: "LineString",
        coordinates: [
          [0, 0],
          [3, 4],
        ],
      }),
    ).toEqual([
      [0, 0],
      [3, 4],
    ]);
    expect(
      completedCoords({
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      }),
    ).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
    expect(completedCoords({ type: "Box", extent: [0, 0, 1, 1] })).toEqual([]);
  });
});
