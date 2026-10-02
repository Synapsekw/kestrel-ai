import type { ReactNode, RefObject } from "react";
import type { CloudClipBox, GeoMap } from "@contract/client";
import type { PointCloud } from "@/api/clouds";
import type { CloudPick, CloudViewerHandle, ViewState } from "@/clouds/CloudViewer";
import type { ColourMode } from "@/clouds/viewer/materialOptions";
import type { MenuItem } from "@/ui";
import type { WorkspaceSeams } from "./seams";
import type { CloudToolId } from "./tools";
import type { CloudTopicId } from "./topics";

/** The viewer's report, or "starting" before its first one. */
export type WorkspaceViewState = ViewState | "starting";

/** What the cloud panel sets and C-R1 records as `CloudViewRender`. */
export interface RenderSettings {
  colour: ColourMode;
  elevationRange: [number, number];
  pointSize: number;
  budget: number;
  edl: boolean;
}

/** A palette tool's behaviour. The workspace routes clicks, hover and keys to the armed one. */
export interface WorkspaceTool {
  id: CloudToolId;
  /** Crosshair and hover picks (≤ 10 Hz) while armed. */
  picks: boolean;
  onArm?(): void;
  onDisarm?(): void;
  onPick?(p: CloudPick): void;
  onHover?(p: CloudPick | null): void;
  /** The hint bar's options and live result. */
  hint?: ReactNode;
  /** Enter, and the hint bar's primary button (labelled `commitLabel`, default "Save"). */
  onCommit?(): void;
  canCommit?: boolean;
  commitLabel?: string;
  /** False hides the hint bar's Save/Cancel pair while the feature shows its own (Enter/Esc still
   * route to `onCommit`/`onCancel`). Default true. */
  hintActions?: boolean;
  /** Backspace: remove the last vertex. */
  onRemoveVertex?(): void;
  /** The first Esc. True when something was dropped (the tool stays armed); false returns to Orbit. */
  onCancel?(): boolean;
  /** Any other clouds key action while armed (e.g. "next-ring"); true when handled. */
  onAction?(action: string): boolean;
}

export interface FeatureContext {
  projectId: string;
  cloud: PointCloud;
  maps: GeoMap[];
  viewer: RefObject<CloudViewerHandle>;
  viewState: WorkspaceViewState;
  /** The armed tool. L1 maps "photo" to its "photo-link" at its call site (plan Ruling 1). */
  activeTool: CloudToolId;
  /** The route's location.search (L1's ?from_image=, P1's ?finding=). */
  search: string;
  seams: WorkspaceSeams;
  render: RenderSettings;
  /** The operator's clip box (null when none): R1's `render.clip_box`, P1's pin hiding. */
  clipBox: CloudClipBox | null;
  arm(id: CloudToolId): void;
  /** Opens a rail topic (the pins feature on a selection, a measure tool on arming). */
  showTopic(id: CloudTopicId): void;
  /** Re-applies the operator's clip box, e.g. after M1's cross-section slab used the engine's box. */
  restoreClipBox(): void;
}

/** What a feature shows for one rail topic (spec §2): a list in the panel, details in the inspector. */
export interface TopicContent {
  /** The rail panel's list (spec §2). */
  list: ReactNode;
  /** The selected item's details, shown in the inspector; null when nothing is selected. */
  detail: ReactNode | null;
  count?: number | null;
  menu?: readonly MenuItem[];
}

export type MinimapMark =
  | { kind: "dot"; x: number; y: number; colour: string; label: string }
  | { kind: "line"; a: [number, number]; b: [number, number] };

/** What one unit adds to the workspace (plan Ruling 1). Every field is optional except the name. */
export interface WorkspaceFeature {
  name: string;
  tools?: readonly WorkspaceTool[];
  findings?: TopicContent;
  measure?: TopicContent;
  /** Extra menu entries for the Findings topic (C-R1's "Capture missing views"). */
  findingsMenu?: readonly MenuItem[];
  /** Shown in the hint bar whatever the tool (R1's "Saving views n / N"). */
  hintProgress?: ReactNode;
  /** A row at the bottom of the Layers topic (L1's camera switch). */
  layersRow?: ReactNode;
  /** In the z 5 layer over the canvas; the host is pointer-events: none, children opt in. */
  layer?: ReactNode;
  /** In the z 12 layer (callout, profile panel, popovers); pointer-events: none on the host. */
  floating?: ReactNode;
  minimap?: readonly MinimapMark[];
}
