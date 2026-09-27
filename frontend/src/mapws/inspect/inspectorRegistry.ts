import type { ComponentType } from "react";
import type { ApiClient } from "@contract/client";
import { Registry } from "../registry";
import type { Selection, SiteFrame } from "../types";

export interface InspectorBodyProps {
  selection: Selection;
  projectId: string;
  frame: SiteFrame;
  onClose: () => void;
}

/** What the inspector shows for one selection kind (spec §5.3). */
export interface InspectorKind {
  /** The selection kind: finding, detection, volume, measurement, drawing, zone. */
  id: string;
  /** The accessible name of the inspector ("Finding"). */
  label: string;
  /** true: the host wraps Body in the 318 px float glass; false: Body renders its own pane (R-W1-11). */
  framed: boolean;
  Body: ComponentType<InspectorBodyProps>;
  /** Replaces the tool hint while this selection is active. */
  hint?: (sel: Selection) => string | null;
  /** `Del` on the selection: a confirm line, then the delete. */
  remove?: {
    confirm: (sel: Selection) => string;
    run: (sel: Selection, ctx: { api: ApiClient; projectId: string }) => Promise<void>;
  };
}

export type InspectorSlotName = "finding.measure";

export interface InspectorSlot {
  id: InspectorSlotName;
  Component: ComponentType<{
    selection: Selection;
    projectId: string;
    frame: SiteFrame;
  }>;
}

export const inspectorRegistry = new Registry<InspectorKind>();
export const slotRegistry = new Registry<InspectorSlot>();
export const registerInspector = (kind: InspectorKind): (() => void) => inspectorRegistry.register(kind);
export const registerSlot = (slot: InspectorSlot): (() => void) => slotRegistry.register(slot);
