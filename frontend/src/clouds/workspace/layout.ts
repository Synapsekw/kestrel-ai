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
