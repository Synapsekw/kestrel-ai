import type { CloudClipBox } from "@contract/client";
import type { Bounds6 } from "@/clouds/viewer/camera";

type Mode = CloudClipBox["mode"];
const MODES: readonly Mode[] = ["show_inside", "highlight_inside"];
const MIN_SIZE_M = 0.1;

/** Plan Ruling 4: the cloud's XY centre, half its XY extent (≥ 1 m), its full Z extent + 2 m. */
export function defaultClipBox(b: Bounds6): CloudClipBox {
  return {
    centre: [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2],
    size: [Math.max(1, (b[3] - b[0]) / 2), Math.max(1, (b[4] - b[1]) / 2), b[5] - b[2] + 2],
    yaw_deg: 0,
    mode: "show_inside",
  };
}

export function recentreClip(box: CloudClipBox, p: { x: number; y: number; z: number }): CloudClipBox {
  return { ...box, centre: [p.x, p.y, p.z] };
}

/** A new size along one axis; a value that is not a positive number keeps the old one. */
export function resizeClip(box: CloudClipBox, axis: 0 | 1 | 2, metres: number): CloudClipBox {
  if (!Number.isFinite(metres) || metres <= 0) return box;
  const size = [...box.size];
  size[axis] = Math.max(MIN_SIZE_M, metres);
  return { ...box, size };
}

/** The box's four XY corners, turned counter-clockwise from east by `yaw_deg` (V2 Ruling 3). */
export function clipFootprint(box: CloudClipBox): [number, number][] {
  const a = (box.yaw_deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const [w, d] = [box.size[0] / 2, box.size[1] / 2];
  return [
    [-w, -d],
    [w, -d],
    [w, d],
    [-w, d],
  ].map(([x, y]) => [box.centre[0] + x * c - y * s, box.centre[1] + x * s + y * c]);
}

export const clipKey = (cloudId: string) => `kestrel.clouds.clip.${cloudId}`;

function local(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const triple = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));

/** The operator's box for this cloud (spec §19: session state per cloud in try/catch storage). */
export function readClip(cloudId: string, storage: Storage | null = local()): CloudClipBox | null {
  try {
    const raw = storage?.getItem(clipKey(cloudId));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<CloudClipBox>;
    if (!triple(v.centre) || !triple(v.size) || v.size.some((n) => n <= 0)) return null;
    if (typeof v.yaw_deg !== "number" || !MODES.includes(v.mode as Mode)) return null;
    return { centre: v.centre, size: v.size, yaw_deg: v.yaw_deg, mode: v.mode as Mode };
  } catch {
    return null;
  }
}

export function writeClip(
  cloudId: string,
  box: CloudClipBox | null,
  storage: Storage | null = local(),
): void {
  try {
    if (box) storage?.setItem(clipKey(cloudId), JSON.stringify(box));
    else storage?.removeItem(clipKey(cloudId));
  } catch {
    // Storage blocked: the box lasts this session.
  }
}
