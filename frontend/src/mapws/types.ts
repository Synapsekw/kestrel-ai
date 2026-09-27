import type { components } from "@contract/client";

type S = components["schemas"];

export type Coord = [number, number];

/** The project's site frame (spec §6, M1, M3), M-C0's schema: kind, crs_wkt, epsg, proj4, name. */
export type SiteFrame = S["SiteFrame"];
/** One row of listWorkspaceLayers: a map, surface or drawing with its site footprint (M-C0). */
export type WorkspaceLayer = S["WorkspaceLayer"];
/** One survey date of listWorkspaceSurveys, planned ones included (M-C0). */
export type Survey = S["WorkspaceSurvey"];

/** `sel=<kind>:<id>`. */
export interface Selection {
  kind: string;
  id: string;
}

export type CompareMode = "single" | "swipe" | "side" | "blend";
/** Which ol/Map instance: one in Single/Swipe/Blend, two in Side-by-side. */
export type MapSide = "single" | "left" | "right";
/** Which compare date a placed row belongs to; undated overlays are "both". */
export type RowSide = "left" | "right" | "both";
