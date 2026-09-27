import { Box3, Matrix4, Quaternion, Vector3 } from "three";
import {
  ClipMode,
  createClipBox,
  type IClipBox,
  type PickParams,
  type PointCloudMaterial,
} from "potree-core";
import type { CloudClipBox } from "@contract/client";
import type { Vec3 } from "./types";

/** A clip box in the cloud's native CRS: centre, full size along its local axes, and its yaw in
 * degrees counter-clockwise from grid east (+x) about +Z (plan Ruling 3). */
export interface ClipBox {
  centre: Vec3;
  size: Vec3;
  yawDeg: number;
}

/** C-C0's `CloudClipBox.mode`: show only the inside, or draw everything and highlight the inside. */
export type ClipBoxMode = "show_inside" | "highlight_inside";

export interface ClipState {
  box: ClipBox;
  mode: ClipBoxMode;
}

type ClipMaterial = Pick<PointCloudMaterial, "clipMode" | "setClipBoxes">;

/** The unit cube (−0.5…0.5) → the box: translate × rotate about Z × scale. */
export function clipBoxMatrix(b: ClipBox): Matrix4 {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), (b.yawDeg * Math.PI) / 180);
  return new Matrix4().compose(new Vector3(...b.centre), q, new Vector3(...b.size));
}

/** potree's `createClipBox` (axis-aligned) with its matrices replaced by the rotated ones; the
 * shader reads only `inverse`. */
export function makeClipBox(b: ClipBox): IClipBox {
  const m = clipBoxMatrix(b);
  const cb = createClipBox(new Vector3(...b.size), new Vector3(...b.centre));
  cb.matrix.copy(m);
  cb.inverse.copy(m).invert();
  cb.box = new Box3(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5)).applyMatrix4(m);
  cb.position.set(...b.centre);
  return cb;
}

/** Inside the box, in float64 (three's matrices are float64 in JS too, but this never forms a
 * UTM-sized product): rotate the offset from the centre by −yaw and compare with the half sizes. */
export function insideClipBox(p: Vec3, b: ClipBox): boolean {
  const a = (b.yawDeg * Math.PI) / 180;
  const dx = p[0] - b.centre[0];
  const dy = p[1] - b.centre[1];
  const dz = p[2] - b.centre[2];
  const lx = Math.cos(a) * dx + Math.sin(a) * dy;
  const ly = -Math.sin(a) * dx + Math.cos(a) * dy;
  const eps = 1e-9;
  return (
    Math.abs(lx) <= b.size[0] / 2 + eps &&
    Math.abs(ly) <= b.size[1] / 2 + eps &&
    Math.abs(dz) <= b.size[2] / 2 + eps
  );
}

/** Picks respect the box in show_inside mode only (plan Ruling 1). */
export function respectClip<T extends { x: number; y: number; z: number }>(
  hits: readonly T[],
  clip: ClipState | null,
): T[] {
  if (!clip || clip.mode !== "show_inside") return [...hits];
  return hits.filter((h) => insideClipBox([h.x, h.y, h.z], clip.box));
}

function potreeMode(clip: ClipState | null): ClipMode {
  if (!clip) return ClipMode.DISABLED;
  return clip.mode === "show_inside" ? ClipMode.CLIP_OUTSIDE : ClipMode.HIGHLIGHT_INSIDE;
}

/** The on-screen material: `CLIP_OUTSIDE` hides what is outside (show inside). */
export function applyClipToMaterial(material: ClipMaterial, clip: ClipState | null): void {
  material.setClipBoxes(clip ? [makeClipBox(clip.box)] : []);
  material.clipMode = potreeMode(clip);
}

/**
 * The spec's picker fallback (§7, §18): whatever potree copied, the pick material clips exactly as
 * the screen hides. In highlight mode nothing is hidden, so the picker draws everything.
 */
export function pickClipParams(clip: ClipState | null): Partial<PickParams> {
  const boxes = clip && clip.mode === "show_inside" ? [makeClipBox(clip.box)] : [];
  return {
    onBeforePickRender: ((material: ClipMaterial) => {
      material.setClipBoxes(boxes);
      material.clipMode = boxes.length > 0 ? ClipMode.CLIP_OUTSIDE : ClipMode.DISABLED;
    }) as Partial<PickParams>["onBeforePickRender"],
  };
}

/** The report view's `render.clip_box` (C-C0's `CloudClipBox`). */
export function toCloudClipBox(clip: ClipState | null): CloudClipBox | null {
  if (!clip) return null;
  return {
    centre: [...clip.box.centre],
    size: [...clip.box.size],
    yaw_deg: clip.box.yawDeg,
    mode: clip.mode,
  };
}
