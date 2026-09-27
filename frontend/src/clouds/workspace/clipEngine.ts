import type { CloudClipBox } from "@contract/client";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";

type V3 = [number, number, number];

/**
 * C-V2's handle member, exactly as its plan states it (`setClipBox(box: ClipBox | null, mode?)`,
 * `ClipBox = {centre, size, yawDeg}`). W1 is cut before V2 merges, so the member is read
 * structurally here (plan Ruling 13); the probe stays correct after the rebase onto V2. This is the
 * one place W1 names a V2 member.
 */
interface ClipCapable {
  setClipBox(box: { centre: V3; size: V3; yawDeg: number } | null, mode?: CloudClipBox["mode"]): void;
}

function clipCapable(h: CloudViewerHandle | null | undefined): ClipCapable | null {
  const probe = h as unknown as Partial<ClipCapable> | null | undefined;
  return typeof probe?.setClipBox === "function" ? (h as unknown as ClipCapable) : null;
}

/** V2 is present (it ships the clip box and fly mode together). */
export function canClip(h: CloudViewerHandle | null | undefined): boolean {
  return clipCapable(h) !== null;
}

const v3 = (a: readonly number[]): V3 => [a[0], a[1], a[2]];

/** Applies the operator's box (or clears it); false when the engine has no clip box yet. */
export function applyClipBox(h: CloudViewerHandle | null | undefined, box: CloudClipBox | null): boolean {
  const c = clipCapable(h);
  if (!c) return false;
  c.setClipBox(
    box ? { centre: v3(box.centre), size: v3(box.size), yawDeg: box.yaw_deg } : null,
    box?.mode ?? "show_inside",
  );
  return true;
}
