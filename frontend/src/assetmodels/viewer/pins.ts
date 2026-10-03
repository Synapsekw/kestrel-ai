// Pins are spheres held at about 6 px on screen and lifted off the wall along the face normal
// (kit engine.js buildPins and renderInto).
export type Vec3 = [number, number, number];

export const PIN_PX = 6;
/** Of the asset height, as the kit's buildPins lifts a pin. */
export const PIN_LIFT_FRACTION = 0.009;

export function worldPerPixelPerspective(fovDeg: number, distance: number, viewportHeightPx: number): number {
  return (2 * Math.tan((fovDeg * Math.PI) / 360) * distance) / Math.max(viewportHeightPx, 1);
}

export function worldPerPixelOrtho(
  top: number,
  bottom: number,
  zoom: number,
  viewportHeightPx: number,
): number {
  return (top - bottom) / Math.max(zoom, 1e-6) / Math.max(viewportHeightPx, 1);
}

/** The scale that draws a sphere of `baseRadius` world units at `px` screen pixels. */
export function pinScale(worldPerPixel: number, baseRadius: number, px = PIN_PX): number {
  return Math.max((px * worldPerPixel) / baseRadius, 1e-4);
}

export function liftedPosition(center: Vec3, normal: Vec3 | null, lift: number): Vec3 {
  if (!normal) return [...center];
  const n = Math.hypot(normal[0], normal[1], normal[2]);
  if (n < 1e-9) return [...center];
  return [
    center[0] + (normal[0] / n) * lift,
    center[1] + (normal[1] / n) * lift,
    center[2] + (normal[2] / n) * lift,
  ];
}
