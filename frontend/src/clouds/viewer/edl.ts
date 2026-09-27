// frontend/src/clouds/viewer/edl.ts
/** Eye-dome lighting through potree-core's PotreeRenderer (spec §3 C13, §7). */
export const EDL_OPTIONS = { strength: 1, radius: 1.4 } as const;

/**
 * potree-core 2.0.15's EDLPass renders its first pass with `setRenderTarget(null)` and composites
 * with `screenPass.render(renderer, edlMaterial, null)`: always to the canvas, never into a caller's
 * render target. Snapshots and captures therefore render without EDL (plan Ruling 3); edl.test.ts
 * pins this against the installed package.
 */
export const EDL_RENDERS_TO_TARGET = false;

/** F's reduced-effects mode (`<html data-effects="reduced">`) turns EDL off. */
export function reducedEffects(): boolean {
  return document.documentElement.dataset.effects === "reduced";
}

/** Calls `onChange(reduced)` whenever `data-effects` changes (Settings, the palette toggle, Auto's probe). */
export function watchEffects(onChange: (reduced: boolean) => void): () => void {
  const observer = new MutationObserver(() => onChange(reducedEffects()));
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-effects"] });
  return () => observer.disconnect();
}
