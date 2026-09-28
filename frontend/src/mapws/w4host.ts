/**
 * M-W4's only door into the workspace shell (M-W1) and the site-tile / swipe helpers (M-W2). Every
 * W4 file — the plugin files included — imports W1/W2 names from here, so a rename upstream is one
 * edit in this file and tests mock one module (plan 2026-09-27-maps-w4, Task 0).
 */
export { useTools, useWorkspace, useWorkspaceStores } from "./context";
export type { MapSide, RowSide, Selection, SiteFrame, Survey, WorkspaceLayer } from "./types";
export type { DrawSpec, Geometry, MapTool, ToolContext, ToolOverlayProps } from "./tools/toolStore";
export {
  SELECTION_PROP,
  type LayerKind,
  type LayerMountProps,
  type LayerRow,
  type LayerRowExtraProps,
  type LayerRowsContext,
} from "./layers/layerRegistry";
export type { InspectorBodyProps, InspectorKind } from "./inspect/inspectorRegistry";
export { useMapPane } from "./view/SiteMap";
export { fillTile, siteTileGrid, siteTileUrl } from "./view/siteFrame";
export { useOpenIn3d, type OpenIn3d } from "./threeD";
export { useWorkspaceLayers } from "./data/useWorkspaceLayers";
export { formatSurveyDate } from "./timeline/timelineModel";
export { mapSurveyDate } from "./arrival/arrival";
export { makeSiteTileLoader } from "./layers/siteTileLoader";
export { attachSwipeClip, type ClipLayer } from "./compare/swipeClip";
export { ConfirmDeleteDialog } from "./layers/ConfirmDeleteDialog";
