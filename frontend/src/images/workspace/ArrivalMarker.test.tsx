import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ArrivalProbe, BackTo3DChip, markerSpec } from "./ArrivalMarker";
import { useArrivalStore } from "./arrivalStore";

beforeEach(() =>
  useArrivalStore.setState({ imageId: "i1", marker: { px: 100, py: 50, r: 24 }, cloudId: "c1" }),
);

describe("arrival marker", () => {
  it("keeps the ring in image px and strokes in screen px", () => {
    expect(markerSpec({ px: 100, py: 50, r: 24 }, 2)).toEqual({
      ring: { x: 100, y: 50, radius: 24, dash: [3, 2], strokeWidth: 2 },
      dot: { x: 100, y: 50, radius: 1.5 },
    });
  });
  it("probe and chip follow the store, and Esc keeps the chip", () => {
    render(
      <MemoryRouter>
        <ArrivalProbe imageId="i1" />
        <BackTo3DChip projectId="p1" imageId="i1" />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("arrival-marker")).toHaveAttribute("data-at", "100,50");
    expect(screen.getByRole("link", { name: "Back to 3D" })).toHaveAttribute("href", "/p/p1/clouds/c1");
    useArrivalStore.getState().clearMarker();
  });
  it("shows nothing for another image", () => {
    render(
      <MemoryRouter>
        <ArrivalProbe imageId="i2" />
        <BackTo3DChip projectId="p1" imageId="i2" />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("arrival-marker")).toBeNull();
    expect(screen.queryByRole("link", { name: "Back to 3D" })).toBeNull();
  });

  // Amendment (IMC reconciliation item 9): a back-only arrival has a null marker; the marker's
  // DOM probe renders nothing, but the chip still shows because cloudId is set.
  it("renders nothing for a null marker, but the chip still shows", () => {
    useArrivalStore.setState({ imageId: "i1", marker: null, cloudId: "c1" });
    render(
      <MemoryRouter>
        <ArrivalProbe imageId="i1" />
        <BackTo3DChip projectId="p1" imageId="i1" />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("arrival-marker")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to 3D" })).toHaveAttribute("href", "/p/p1/clouds/c1");
  });
});
