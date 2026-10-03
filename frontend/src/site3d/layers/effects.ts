import { reducedEffects, watchEffects } from "@/clouds/viewer/edl";

/** DESIGN.md "Reduced effects" (`<html data-effects="reduced">`); delegates to the cloud viewer's probe. */
export const isReducedEffects: () => boolean = reducedEffects;

/** Calls `cb` whenever Settings or the auto probe switches the effects mode. */
export function onEffectsChange(cb: () => void): () => void {
  return watchEffects(() => cb());
}
