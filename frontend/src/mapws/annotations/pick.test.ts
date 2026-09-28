import { describe, expect, it } from "vitest";
import {
  AUG,
  DESIGN,
  DSM_AUG,
  DSM_SEP,
  LAYERS,
  MAP_AUG,
  MAP_SEP,
  SEP,
  SHOWN_ALL,
  SURVEYS,
} from "@/mapws/test/w3Fixtures";
import type { WorkspaceLayer } from "./bindings";
import {
  elevationLayers,
  findingMapIds,
  hasElevation,
  hasOrtho,
  mapOfDate,
  pickAnchorMap,
  pickDsm,
  pickProfileSurfaces,
  seriesRole,
} from "./pick";

const inside = [500500, 3300500];
const outside = [600000, 3300500];
const single = { l: AUG, r: SEP, mode: "single" as const };
const swipe = { ...single, mode: "swipe" as const };
const hide = (key: string) => ({
  layerState: { [key]: { visible: false, opacity: 100 } },
  order: {},
});
const ids = (xs: readonly { id: string }[]) => xs.map((l) => l.id);
const withLayer = (id: string, patch: Partial<WorkspaceLayer>) =>
  LAYERS.map((l) => (l.id === id ? { ...l, ...patch } : l));

describe("pickAnchorMap (W3-5)", () => {
  it("takes the visible ortho of the right date under the point", () => {
    expect(pickAnchorMap(LAYERS, SHOWN_ALL, SEP, inside)?.id).toBe(MAP_SEP);
  });

  it("refuses outside every footprint, for a hidden ortho, or a date with no ortho", () => {
    expect(pickAnchorMap(LAYERS, SHOWN_ALL, SEP, outside)).toBeNull();
    expect(pickAnchorMap(LAYERS, hide(`map:${MAP_SEP}`), SEP, inside)).toBeNull();
    expect(pickAnchorMap(LAYERS, SHOWN_ALL, "2026-10-14", inside)).toBeNull();
  });

  it("never falls back to another date's map", () => {
    const onlyAug = LAYERS.filter((l) => l.id !== MAP_SEP);
    expect(pickAnchorMap(onlyAug, SHOWN_ALL, SEP, inside)).toBeNull();
    expect(mapOfDate(LAYERS, SHOWN_ALL, AUG)?.id).toBe(MAP_AUG);
  });
});

describe("elevation picking (W3-6, W3-7)", () => {
  it("a date's DSM: a cloud DSM or a dem with role dsm", () => {
    expect(pickDsm(LAYERS, SHOWN_ALL, AUG)?.id).toBe(DSM_AUG);
    expect(pickDsm(LAYERS, SHOWN_ALL, SEP)?.id).toBe(DSM_SEP);
    expect(pickDsm(LAYERS, SHOWN_ALL, "2026-10-14")).toBeNull();
  });

  it("a dtm is not a DSM", () => {
    const dtm = withLayer(DSM_SEP, { elevation_role: "dtm" });
    expect(pickDsm(dtm, SHOWN_ALL, SEP)).toBeNull();
  });

  it("profile surfaces: design then the right DSM in Single; the left DSM first in compare", () => {
    expect(ids(pickProfileSurfaces(LAYERS, SHOWN_ALL, single))).toEqual([DESIGN, DSM_SEP]);
    expect(ids(pickProfileSurfaces(LAYERS, SHOWN_ALL, swipe))).toEqual([DSM_AUG, DESIGN, DSM_SEP]);
  });

  it("a hidden design is left out; with no DSM of either date any surface is used, else none", () => {
    expect(ids(pickProfileSurfaces(LAYERS, hide(`surface:${DESIGN}`), single))).toEqual([DSM_SEP]);
    const designOnly = LAYERS.filter((l) => l.kind !== "surface" || l.id === DESIGN);
    expect(ids(pickProfileSurfaces(designOnly, SHOWN_ALL, single))).toEqual([DESIGN]);
    const none = LAYERS.filter((l) => l.kind !== "surface");
    expect(pickProfileSurfaces(none, SHOWN_ALL, single)).toEqual([]);
    expect(hasElevation(none)).toBe(false);
  });

  it("orders elevation layers as the layers panel does, top first", () => {
    // W2's byNewest (undated first, then newest) and W1's orderRows (unplaced rows first).
    expect(ids(elevationLayers(LAYERS, SHOWN_ALL))).toEqual([DESIGN, DSM_SEP, DSM_AUG]);
    const ordered = {
      layerState: {},
      order: { elevation: [`surface:${DESIGN}`, `surface:${DSM_SEP}`] },
    };
    expect(ids(elevationLayers(LAYERS, ordered))).toEqual([DSM_AUG, DESIGN, DSM_SEP]);
  });

  it("the fallback surface is the panel's topmost visible one", () => {
    const dtms = LAYERS.filter((l) => l.id !== DESIGN).map((l) =>
      l.kind === "surface" ? { ...l, surface_kind: "dem" as const, elevation_role: "dtm" as const } : l,
    );
    expect(ids(pickProfileSurfaces(dtms, SHOWN_ALL, single))).toEqual([DSM_SEP]);
    expect(ids(pickProfileSurfaces(dtms, hide(`surface:${DSM_SEP}`), single))).toEqual([DSM_AUG]);
  });

  it("assigns chart roles by date and kind", () => {
    expect(seriesRole(DSM_AUG, LAYERS, swipe)).toBe("left");
    expect(seriesRole(DSM_SEP, LAYERS, swipe)).toBe("right");
    expect(seriesRole(DESIGN, LAYERS, swipe)).toBe("design");
    expect(seriesRole("gone", LAYERS, swipe)).toBe("other");
  });
});

describe("only usable layers are picked (M-W3 P4)", () => {
  it("skips a layer outside the site frame", () => {
    const off = withLayer(MAP_SEP, { in_frame: false });
    expect(pickAnchorMap(off, SHOWN_ALL, SEP, inside)).toBeNull();
    expect(mapOfDate(off, SHOWN_ALL, SEP)).toBeNull();
    expect(pickDsm(withLayer(DSM_SEP, { in_frame: false }), SHOWN_ALL, SEP)).toBeNull();
    const noDesign = withLayer(DESIGN, { in_frame: false });
    expect(ids(elevationLayers(noDesign, SHOWN_ALL))).toEqual([DSM_SEP, DSM_AUG]);
    expect(hasOrtho(LAYERS.map((l) => ({ ...l, in_frame: false })))).toBe(false);
  });

  it("skips a layer that is not ready", () => {
    const importing = withLayer(MAP_SEP, { status: "importing" });
    expect(pickAnchorMap(importing, SHOWN_ALL, SEP, inside)).toBeNull();
    expect(mapOfDate(importing, SHOWN_ALL, SEP)).toBeNull();
    const failed = withLayer(DSM_AUG, { status: "failed" });
    expect(pickDsm(failed, SHOWN_ALL, AUG)).toBeNull();
    expect(ids(pickProfileSurfaces(failed, SHOWN_ALL, swipe))).toEqual([DESIGN, DSM_SEP]);
    expect(hasElevation(LAYERS.map((l) => ({ ...l, status: "importing" as const })))).toBe(false);
  });

  it("skips a layer the session has dropped as gone", () => {
    const gone = (key: string) => ({ ...SHOWN_ALL, gone: new Set([key]) });
    expect(pickAnchorMap(LAYERS, gone(`map:${MAP_SEP}`), SEP, inside)).toBeNull();
    expect(mapOfDate(LAYERS, gone(`map:${MAP_SEP}`), SEP)).toBeNull();
    expect(pickDsm(LAYERS, gone(`surface:${DSM_SEP}`), SEP)).toBeNull();
    expect(ids(pickProfileSurfaces(LAYERS, gone(`surface:${DESIGN}`), single))).toEqual([DSM_SEP]);
    expect(ids(elevationLayers(LAYERS, gone(`surface:${DSM_AUG}`)))).toEqual([DESIGN, DSM_SEP]);
  });
});

describe("findingMapIds (W3-13)", () => {
  it("Single shows r; Swipe shows l and r; Side-by-side shows each map its own date", () => {
    expect(findingMapIds(SURVEYS, single, "single")).toEqual([MAP_SEP]);
    expect(findingMapIds(SURVEYS, swipe, "single")).toEqual([MAP_AUG, MAP_SEP]);
    expect(findingMapIds(SURVEYS, { ...single, mode: "side" }, "left")).toEqual([MAP_AUG]);
    expect(findingMapIds(SURVEYS, { ...single, mode: "side" }, "right")).toEqual([MAP_SEP]);
    expect(findingMapIds(SURVEYS, { ...single, r: null }, "single")).toEqual([]);
  });
});
