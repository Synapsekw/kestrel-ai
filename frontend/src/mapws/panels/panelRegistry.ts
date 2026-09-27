import type { ComponentType } from "react";
import { Registry } from "../registry";
import type { SiteFrame } from "../types";

/**
 * Where a panel plugin renders (spec §5 layout): top-center = the compare panel (top 16, centred);
 * bottom-center = the timeline; bottom-right = the minimap (172 × 110); coords-extra = a row inside
 * the coordinates panel (the Z readout); stage = over the maps, under the panels (swipe divider,
 * side labels, ghost crosshair). W1 positions the slot; the panel draws itself.
 */
export type PanelSlot = "top-center" | "bottom-center" | "bottom-right" | "coords-extra" | "stage";

export interface PanelProps {
  projectId: string;
  frame: SiteFrame;
}

export interface WorkspacePanel {
  id: string;
  slot: PanelSlot;
  order: number;
  Component: ComponentType<PanelProps>;
}

export const panelRegistry = new Registry<WorkspacePanel>();
export const registerPanel = (panel: WorkspacePanel): (() => void) => panelRegistry.register(panel);
