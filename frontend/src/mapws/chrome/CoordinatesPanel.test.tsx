import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeStores, renderInWorkspace } from "../test/harness";
import { LOCAL } from "../test/fixtures";
import { CoordinatesPanel } from "./CoordinatesPanel";

describe("CoordinatesPanel (spec §5 Coordinates)", () => {
  it("shows the CRS chip, E and N, the scale bar, and toggles WGS84", () => {
    const { stores } = renderInWorkspace(<CoordinatesPanel projectId="p1" />);
    act(() => {
      stores.workspace.getState().setPointer([500788.25, 4981839.5]);
      stores.workspace.getState().setViewInfo({ center: [0, 0], resolution: 0.5, rotation: 0 });
    });
    const chip = screen.getByRole("button", {
      name: /EPSG:32633 · WGS 84 \/ UTM zone 33N/,
    });
    expect(screen.getByText("500788.25")).toBeInTheDocument();
    expect(screen.getByText("4981839.50")).toBeInTheDocument();
    expect(screen.getByText("50 m")).toBeInTheDocument();
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/° N, .*° E/)).toBeInTheDocument();
  });

  it("reads Local metres in a local frame, without the WGS84 toggle (Review Focus 1)", () => {
    const stores = makeStores({ frame: LOCAL });
    renderInWorkspace(<CoordinatesPanel projectId="p1" />, { stores });
    expect(screen.getByRole("button", { name: /Local metres/ })).toBeDisabled();
  });
});
