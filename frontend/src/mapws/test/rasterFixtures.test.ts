import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useWorkspace } from "../context";
import { makeStores } from "./harness";
import {
  AUG,
  FOOT,
  fakeOlMap,
  layerFeed,
  mapLayer,
  surfaceLayer,
  surveyMap,
  surveySurface,
  workspaceWrapper,
} from "./rasterFixtures";

describe("raster fixtures", () => {
  it("builds contract WorkspaceLayers with the surface fields at the top level", () => {
    expect(mapLayer("a", AUG)).toMatchObject({
      kind: "map",
      id: "a",
      group: "base",
      tile_kind: "map",
      date: AUG,
      footprint_site: FOOT,
      surface_kind: null,
      elevation_role: null,
    });
    expect(surfaceLayer("s", null, "design")).toMatchObject({
      kind: "surface",
      group: "elevation",
      surface_kind: "design",
      elevation_role: null,
    });
    expect(surfaceLayer("d", AUG, "dem")).toMatchObject({ surface_kind: "dem", elevation_role: "dtm" });
    expect(surfaceLayer("c", AUG)).toMatchObject({ surface_kind: "cloud_dsm", elevation_role: "dsm" });
    expect(mapLayer("x", AUG, { date_is_import_date: true }).date_is_import_date).toBe(true);
  });

  it("builds the survey's map and surface entries", () => {
    expect(surveyMap("m1")).toEqual({ id: "m1", name: "m1", gsd_cm: 3, basis_run_id: null });
    expect(surveySurface("s1", "dem", "dtm")).toEqual({
      id: "s1",
      name: "s1",
      kind: "dem",
      elevation_role: "dtm",
    });
  });

  it("exposes a mutable layer feed and a spying ol/Map stand-in", () => {
    expect(layerFeed).toEqual({ layers: [], loading: false });
    const map = fakeOlMap();
    map.addLayer("x");
    expect(map.addLayer).toHaveBeenCalledWith("x");
    expect(map.getView().getProjection()).toBe("EPSG:32633");
  });

  it("wraps a tree in the workspace providers so rerender keeps them", () => {
    const stores = makeStores();
    function Mode({ tag }: { tag: string }) {
      const mode = useWorkspace((s) => s.mode);
      return createElement("p", null, `${tag} ${mode}`);
    }
    const view = render(createElement(Mode, { tag: "a" }), { wrapper: workspaceWrapper(stores) });
    expect(screen.getByText("a single")).toBeInTheDocument();
    view.rerender(createElement(Mode, { tag: "b" }));
    expect(screen.getByText("b single")).toBeInTheDocument();
  });
});
