import { useSamStore, type SmartPolygon } from "./sam/useSmartPolygon";

/**
 * The workspace's one S session, set by `SmartPolygonSession` (inside `SmartPolygonPanel`). The tool
 * definition is module-level, so its callbacks reach the session here; the panel reads it too.
 */
export const samHandle = () => useSamStore.getState().handle;
export const useSamHandle = () => useSamStore((s) => s.handle);
export const setSamHandle = (handle: SmartPolygon | null) => useSamStore.setState({ handle });

/**
 * True when nothing a reader of the handle sees has changed. `useSmartPolygon` returns a new object
 * on every render (a pan frame re-renders it, R-FA8), so publishing only real changes keeps the
 * panel still while the operator pans.
 */
export function sameHandle(a: SmartPolygon, b: SmartPolygon): boolean {
  const keys = Object.keys(a) as (keyof SmartPolygon)[];
  const assistKeys = Object.keys(a.assist) as (keyof SmartPolygon["assist"])[];
  return (
    keys.every((k) => k === "assist" || a[k] === b[k]) && assistKeys.every((k) => a.assist[k] === b.assist[k])
  );
}
