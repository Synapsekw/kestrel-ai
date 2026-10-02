import type { ReactNode } from "react";
import type { MenuItem } from "@/ui";
import type { CloudToolId } from "./tools";
import type { MinimapMark, TopicContent, WorkspaceFeature, WorkspaceTool } from "./types";

export interface Slot {
  key: string;
  node: ReactNode;
}

export interface ComposedFeatures {
  tools: WorkspaceTool[];
  /** The Findings topic; its `menu` ends with every feature's `findingsMenu`. */
  findings: TopicContent | null;
  measure: TopicContent | null;
  hintProgress: ReactNode;
  /** Rows at the bottom of the Layers topic. */
  layersRows: Slot[];
  layers: Slot[];
  floating: Slot[];
  minimap: MinimapMark[];
}

export const NO_FEATURE = (name: string): WorkspaceFeature => ({ name });

/** Merges the units' features in order; the first registration of a tool id or a topic wins. */
export function composeFeatures(features: readonly WorkspaceFeature[]): ComposedFeatures {
  const out: ComposedFeatures = {
    tools: [],
    findings: null,
    measure: null,
    hintProgress: null,
    layersRows: [],
    layers: [],
    floating: [],
    minimap: [],
  };
  const findingsMenu: MenuItem[] = [];
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
    out.findings ??= f.findings ?? null;
    out.measure ??= f.measure ?? null;
    findingsMenu.push(...(f.findingsMenu ?? []));
    out.hintProgress ??= f.hintProgress ?? null;
    if (f.layersRow) out.layersRows.push({ key: f.name, node: f.layersRow });
    if (f.layer) out.layers.push({ key: f.name, node: f.layer });
    if (f.floating) out.floating.push({ key: f.name, node: f.floating });
    out.minimap.push(...(f.minimap ?? []));
  }
  if (out.findings && findingsMenu.length > 0)
    out.findings = { ...out.findings, menu: [...(out.findings.menu ?? []), ...findingsMenu] };
  return out;
}
