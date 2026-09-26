/** Render only while there is something to render (spec §8 "Loop"): an idle 3D view holds no GPU. */
export const IDLE_AFTER_MS = 1000;

export function shouldKeepRendering(s: {
  nodesLoading: number;
  pendingLoads: number;
  lastActivityAt: number;
  now: number;
  hidden: boolean;
}): boolean {
  if (s.hidden) return false;
  return s.nodesLoading > 0 || s.pendingLoads > 0 || s.now - s.lastActivityAt < IDLE_AFTER_MS;
}
