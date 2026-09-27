import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { exampleCloud } from "@/test/cloudFixtures";
import { MAP_ID } from "@/test/fixtures";
import { LocationProbe } from "@/test/render";
import { makeStores, renderInWorkspace } from "../test/harness";
import { survey } from "../test/fixtures";
import { StageMenu } from "./StageMenu";

const frame = {
  kind: "crs" as const,
  crs_wkt: "x",
  epsg: 32639,
  proj4: exampleCloud.proj4,
  name: "UTM 39N",
};

function setup(linked: boolean) {
  const stores = makeStores({
    frame,
    surveys: [
      survey("2026-09-14", {
        maps: [{ id: MAP_ID, name: "Ortho", gsd_cm: 3, basis_run_id: null }],
      }),
    ],
  });
  act(() => {
    stores.workspace.getState().setClouds(linked ? [{ ...exampleCloud, map_id: MAP_ID }] : []);
    stores.workspace.getState().openStageMenu({ x: 100, y: 120, coord: [243500, 3178200] });
  });
  renderInWorkspace(
    <>
      <StageMenu />
      <LocationProbe />
    </>,
    { stores },
  );
  return stores;
}

describe("the stage's right-click menu", () => {
  it("opens this spot in 3D", () => {
    const stores = setup(true);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open this spot in 3D" }));
    expect(screen.getByTestId("location")).toHaveTextContent(/\/clouds\/.+\?at=243500\.000,3178200\.000/);
    expect(stores.workspace.getState().stageMenu).toBeNull();
  });

  it("is disabled with the reason when no cloud is linked to the date, and closes on Esc", () => {
    const stores = setup(false);
    expect(screen.getByRole("menuitem", { name: "Open this spot in 3D" })).toBeDisabled();
    expect(screen.getByText("No point cloud is linked to the 2026-09-14 survey.")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(stores.workspace.getState().stageMenu).toBeNull();
  });
});
