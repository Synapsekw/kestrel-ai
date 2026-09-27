import type { ReactNode } from "react";
import type { MenuItem } from "@/ui";
import type { CloudToolId } from "./tools";
import type { MinimapMark, TabContent, WorkspaceFeature, WorkspaceTool } from "./types";

export interface Slot {
  key: string;
  node: ReactNode;
}

export interface ComposedFeatures {
  tools: WorkspaceTool[];
  findingsTab: TabContent | null;
  measurementsTab: TabContent | null;
  findingsMenu: MenuItem[];
  hintProgress: ReactNode;
  cloudPanel: Slot[];
  layers: Slot[];
  floating: Slot[];
  minimap: MinimapMark[];
}

export const NO_FEATURE = (name: string): WorkspaceFeature => ({ name });

/** Merges the units' features in order; the first registration of a tool id or a tab wins. */
export function composeFeatures(features: readonly WorkspaceFeature[]): ComposedFeatures {
  const out: ComposedFeatures = {
    tools: [],
    findingsTab: null,
    measurementsTab: null,
    findingsMenu: [],
    hintProgress: null,
    cloudPanel: [],
    layers: [],
    floating: [],
    minimap: [],
  };
  const seen = new Set<CloudToolId>();
  for (const f of features) {
    for (const t of f.tools ?? []) {
      if (seen.has(t.id)) {
        console.error(`workspace: tool "${t.id}" registered again by "${f.name}"; the first one stays`);
        continue;
      }
      seen.add(t.id);
      out.tools.push(t);
    }
    out.findingsTab ??= f.findingsTab ?? null;
    out.measurementsTab ??= f.measurementsTab ?? null;
    out.findingsMenu.push(...(f.findingsMenu ?? []));
    out.hintProgress ??= f.hintProgress ?? null;
    if (f.cloudPanel) out.cloudPanel.push({ key: f.name, node: f.cloudPanel });
    if (f.layer) out.layers.push({ key: f.name, node: f.layer });
    if (f.floating) out.floating.push({ key: f.name, node: f.floating });
    out.minimap.push(...(f.minimap ?? []));
  }
  return out;
}
