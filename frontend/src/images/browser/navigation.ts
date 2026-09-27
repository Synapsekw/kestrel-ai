import type { ImageIndexState } from "./useImageIndex";

/** Prev/next in index order (FW's ← / →, the filmstrip's buttons, "Image 212 / 312"). */
export function indexNeighbours(
  index: Pick<ImageIndexState, "ids" | "ordinalOf">,
  currentId: string | null,
): { ordinal: number; prev: string | null; next: string | null } {
  const ordinal = index.ordinalOf(currentId);
  if (ordinal < 0) return { ordinal: -1, prev: null, next: index.ids[0] ?? null };
  return {
    ordinal,
    prev: ordinal > 0 ? index.ids[ordinal - 1] : null,
    next: ordinal < index.ids.length - 1 ? index.ids[ordinal + 1] : null,
  };
}
