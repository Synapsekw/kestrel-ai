/**
 * The bottom row's geometry (spec §6), shared by the gizmo, the minimap and the readout so the
 * readout's band is derived from the real panel sizes, not a guess at them. Pixels.
 */
export const EDGE = 14;
/** Gizmo: left 72, bottom 14; fixed width so the readout band can start after it. */
export const GIZMO_LEFT = 72;
export const GIZMO_WIDTH = 204;
/** Minimap: right 14, bottom 14, 330 × 178. */
export const MINIMAP_WIDTH = 330;
export const MINIMAP_HEIGHT = 178;
/** Clear space between the readout and its neighbours. */
export const READOUT_GAP = 8;
/** The band the readout pill is centred in: between the gizmo's right edge and the minimap's left. */
export const READOUT_BAND = {
  left: GIZMO_LEFT + GIZMO_WIDTH + READOUT_GAP,
  right: EDGE + MINIMAP_WIDTH + READOUT_GAP,
} as const;

/** Cloud panel: left 72, top 14, width 282. Inspector: right 14, top 14, width 330 (spec §6). */
export const CLOUD_PANEL_LEFT = GIZMO_LEFT;
export const CLOUD_PANEL_WIDTH = 282;
export const INSPECTOR_WIDTH = 330;
/** The hint bar's height (one line of `sm` buttons in a py-2 pill), rounded up. */
export const HINT_BAR_HEIGHT = 48;
/**
 * Where the viewer's notices (no WebGL, load error, lost context with "Reload view") go: the free
 * centre band between the cloud panel and the inspector, below the hint bar, so no panel covers them.
 */
export const NOTICE_INSET = {
  left: CLOUD_PANEL_LEFT + CLOUD_PANEL_WIDTH + EDGE,
  right: EDGE + INSPECTOR_WIDTH + EDGE,
  top: EDGE + HINT_BAR_HEIGHT + READOUT_GAP,
} as const;

/** The readout pill's height (one line, spec §6); pinned by e2e/clouds-workspace.spec.ts. */
export const READOUT_HEIGHT = 48;
/**
 * The profile panel (C-M1 §8.3): the free centre band, above the readout pill so it never covers
 * it. Same left/right as `NOTICE_INSET` (between the cloud panel and the inspector).
 */
export const PROFILE_PANEL = {
  left: NOTICE_INSET.left,
  right: NOTICE_INSET.right,
  bottom: EDGE + READOUT_HEIGHT + READOUT_GAP,
  height: 220,
} as const;
