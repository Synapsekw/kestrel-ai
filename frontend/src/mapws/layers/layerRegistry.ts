import type { ComponentType } from "react";
import type OlMap from "ol/Map";
import type { IconName, MenuItem } from "@/ui";
import { Registry } from "../registry";
import type { RowSide, SiteFrame, Survey, WorkspaceLayer } from "../types";

/** The layer groups, bottom to top (spec §5.2: the stacking is fixed). */
export type LayerGroup = "base" | "elevation" | "drawings" | "annotations";
export const GROUP_ORDER: readonly LayerGroup[] = ["base", "elevation", "drawings", "annotations"];
export const GROUP_LABEL: Record<LayerGroup, string> = {
  base: "Base maps",
  elevation: "Elevation",
  drawings: "Drawings",
  annotations: "Annotations",
};

/** An OL feature property holding a `Selection`: the Select tool opens what it names (R-W1-12). */
export const SELECTION_PROP = "mapws:sel";

export interface LayerRow {
  /** Stable, `<kind>:<id>`: the key of the persisted layer state and of the order. */
  key: string;
  /** The LayerKind id that owns the row. */
  kind: string;
  group: LayerGroup;
  /** The entity id, or the kind id for a singleton annotation row. */
  id: string;
  name: string;
  meta: string;
  /** YYYY-MM-DD for dated rows (base maps, elevation); null for undated overlays. */
  date: string | null;
  /** "GEO" for a georeferenced drawing. */
  badge?: string;
  /** A data colour for the swatch, applied through `--c`. */
  swatch?: string;
  version?: string;
  layer?: WorkspaceLayer;
  /** A greyed row that cannot be drawn (a map with no CRS), with where to go instead. */
  unavailable?: { reason: string; href: string; linkLabel: string };
}

export interface LayerRowsContext {
  projectId: string;
  frame: SiteFrame;
  /** listWorkspaceLayers' rows; `in_frame: false` rows have no tiles (no CRS, other frame, not placed). */
  layers: readonly WorkspaceLayer[];
  surveys: readonly Survey[];
}

export interface LayerMountProps {
  row: LayerRow;
  /** The ol/Map of this side; add the layer on mount, remove it on unmount. */
  map: OlMap;
  side: RowSide;
  zIndex: number;
  /** 0…1, already multiplied by the blend in Blend mode. */
  opacity: number;
  style: Record<string, unknown>;
  projectId: string;
  frame: SiteFrame;
}

export interface LayerRowExtraProps {
  row: LayerRow;
  style: Record<string, unknown>;
  setStyle: (patch: Record<string, unknown>) => void;
}

export interface LayerKind {
  /** The kind id: rows carry it in `LayerRow.kind`. */
  id: string;
  group: LayerGroup;
  icon: IconName;
  rows(ctx: LayerRowsContext): LayerRow[];
  /** Mounts the OL layer(s) of one visible row on one map side; renders nothing. */
  Mount?: ComponentType<LayerMountProps>;
  /** The row menu (⋯). */
  menu?(row: LayerRow): MenuItem[];
  /** Controls under the opacity slider (a DXF layer list, render mode). */
  RowExtra?: ComponentType<LayerRowExtraProps>;
  /** Show the opacity slider (default true). */
  opacity?: boolean;
  /** Visible before the operator touches the eye (default true). */
  defaultVisible?: boolean;
}

export const layerRegistry = new Registry<LayerKind>();
export const registerLayerKind = (kind: LayerKind): (() => void) => layerRegistry.register(kind);
