import type { Box } from "@contract/client";

/** Index flag bit for "pending suggestions" (C0 `ImageIndex.flags`). */
export const PENDING_FLAG = 2;

export interface Visibility {
  /** 0..0.95; unreviewed below it are hidden and not targeted. */
  threshold: number;
  /** FC's `showSuggestions` (G, FC's key): off hides the layer and the A/X targets. */
  show: boolean;
  /** Review requests in flight: already decided from the operator's point of view. */
  inFlight: ReadonlySet<string>;
}

export function isPending(b: Box): boolean {
  return b.review_state === "unreviewed" && b.shape !== "point";
}

const conf = (b: Box) => b.confidence ?? 1;
const byConfidence = (a: Box, b: Box) => conf(b) - conf(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The suggestions drawn and targeted, highest confidence first. */
export function visibleSuggestions(
  boxes: Record<string, Box>,
  order: readonly string[],
  v: Visibility,
): Box[] {
  if (!v.show) return [];
  const out: Box[] = [];
  for (const id of order) {
    const b = boxes[id];
    if (!b || !isPending(b) || v.inFlight.has(id)) continue;
    if (v.threshold > 0 && conf(b) < v.threshold) continue;
    out.push(b);
  }
  return out.sort(byConfidence);
}

export function hiddenCount(boxes: Record<string, Box>, order: readonly string[], threshold: number): number {
  if (threshold <= 0) return 0;
  let n = 0;
  for (const id of order) {
    const b = boxes[id];
    if (b && isPending(b) && conf(b) < threshold) n += 1;
  }
  return n;
}

/** R-FA1: the focused pending suggestion (FC's `focusedSuggestionId`) if visible, else the top one. */
export function targetOf(visible: readonly Box[], focusedId: string | null): Box | null {
  return visible.find((b) => b.id === focusedId) ?? visible[0] ?? null;
}

/** R-FA10: pending suggestions (already sorted), then the image's findings in canvas order. */
export function walkOrder(
  visible: readonly Box[],
  order: readonly string[],
  hasFinding: (id: string) => boolean,
): string[] {
  const seen = new Set(visible.map((b) => b.id));
  return [...visible.map((b) => b.id), ...order.filter((id) => !seen.has(id) && hasFinding(id))];
}

export type Step = { kind: "box"; id: string } | { kind: "cross" };

export function stepWalk(seq: readonly string[], current: string | null, dir: 1 | -1): Step {
  if (seq.length === 0) return { kind: "cross" };
  const at = current === null ? -1 : seq.indexOf(current);
  if (at === -1) return { kind: "box", id: dir === 1 ? seq[0] : seq[seq.length - 1] };
  const next = at + dir;
  return next < 0 || next >= seq.length ? { kind: "cross" } : { kind: "box", id: seq[next] };
}

/** The next (or previous) image in index order with pending suggestions; no wrap. */
export function nextFlaggedImage(
  index: { ids: readonly string[]; flags: readonly number[] },
  currentId: string | null,
  dir: 1 | -1,
): string | null {
  const at = currentId === null ? -1 : index.ids.indexOf(currentId);
  const start = at === -1 ? (dir === 1 ? 0 : index.ids.length - 1) : at + dir;
  for (let i = start; i >= 0 && i < index.ids.length; i += dir) {
    if ((index.flags[i] & PENDING_FLAG) !== 0 && index.ids[i] !== currentId) return index.ids[i];
  }
  return null;
}

/** A closed outline in image px as a flat Konva `points` array. Points (markers) have none. */
export function outlineOf(b: Box): number[] {
  if (b.shape === "polygon" && b.points) return b.points.flatMap(([x, y]) => [x, y]);
  if (b.shape === "point") return [];
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const a = (b.angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const corners: [number, number][] = [
    [-b.w / 2, -b.h / 2],
    [b.w / 2, -b.h / 2],
    [b.w / 2, b.h / 2],
    [-b.w / 2, b.h / 2],
  ];
  // Clockwise in image coordinates (y down), about the box's own centre: the contract's convention.
  return corners.flatMap(([dx, dy]) => [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos]);
}

export function boundsOf(flat: readonly number[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (let i = 0; i < flat.length; i += 2) {
    x0 = Math.min(x0, flat[i]);
    x1 = Math.max(x1, flat[i]);
    y0 = Math.min(y0, flat[i + 1]);
    y1 = Math.max(y1, flat[i + 1]);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
