import * as THREE from "three";
import type { CloudViewPose } from "@contract/client";
import { nearFar, siteDiagonal, type Bounds6, type Vec3 as XYZ } from "./camera";
import { overlayObject, type OverlayShape } from "./overlay";
import type { Vec3 } from "./types";

export const CAPTURE_WIDTH = 1600;
export const CAPTURE_HEIGHT = 1000;
export const CAPTURE_ASPECT = 1.6;
export const CAPTURE_TIMEOUT_MS = 10_000;
/** 6 MiB: over it the PNG is re-encoded as JPEG (spec §11.1). */
export const VIEW_MAX_BYTES = 6 * 1024 * 1024;
export const JPEG_QUALITY = 0.92;
/** The finding pin's diameter in the 1600 × 1000 image. */
export const PIN_SPRITE_PX = 28;
const SPRITE_TEXTURE_PX = 64;

/** What a capture draws besides the cloud: a finding is a pin at its anchor, a measurement its
 * overlay geometry (spec §7 Capture step 3). */
export type CaptureMark = { kind: "finding"; at: Vec3 } | { kind: "measurement"; shapes: OverlayShape[] };

export interface CaptureResult {
  blob: Blob;
  width: typeof CAPTURE_WIDTH;
  height: typeof CAPTURE_HEIGHT;
  /** False when the timeout came before every node for the pose had loaded (`render.complete`). */
  complete: boolean;
  /** Whether EDL is in the image (`render.edl`); false with potree-core 2.0.15 (plan Ruling 5). */
  edl: boolean;
  pose: CloudViewPose;
}

/** The PNG is fully opaque, whatever alpha the target held. In place. */
export function opaque(rgba: Uint8ClampedArray): Uint8ClampedArray {
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return rgba;
}

/**
 * A 0-255 token as a three colour whose bytes reach a linear render target unchanged (plan Ruling
 * 6). `tokenColor` decodes sRGB for the canvas, which encodes it back; a render target does not.
 */
export function rawColor(rgb: [number, number, number]): THREE.Color {
  return new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.LinearSRGBColorSpace);
}

/** The finding mark: an accent disc inside a white ring, antialiased, transparent outside. The
 * accent, deliberately not the severity colour, so a regrade never makes the image stale. */
export function pinSpriteRgba(size: number, accent: [number, number, number]): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  const outer = size / 2 - 0.5;
  const inner = outer * 0.72;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x - c, y - c);
      const alpha = Math.min(Math.max(outer + 0.5 - d, 0), 1);
      if (alpha === 0) continue;
      const rgb = d >= inner ? [255, 255, 255] : accent;
      out.set([rgb[0], rgb[1], rgb[2], Math.round(255 * alpha)], 4 * (y * size + x));
    }
  }
  return out;
}

/** The pin texture for `markObjects`: raw bytes (`NoColorSpace`), plan Ruling 6. */
export function pinTexture(accent: [number, number, number]): THREE.DataTexture {
  const t = new THREE.DataTexture(
    pinSpriteRgba(SPRITE_TEXTURE_PX, accent),
    SPRITE_TEXTURE_PX,
    SPRITE_TEXTURE_PX,
    THREE.RGBAFormat,
  );
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** A `sizeAttenuation: false` sprite's scale for `px` pixels on a `heightPx` image at `fovDeg`. */
export function spriteScale(px: number, heightPx: number, fovDeg: number): number {
  return (px / heightPx) * 2 * Math.tan((fovDeg * Math.PI) / 360);
}

export function captureCameraParams(
  pose: CloudViewPose,
  bounds: Bounds6 | null,
): { fov: number; aspect: number; near: number; far: number } {
  const d = Math.hypot(
    pose.position[0] - pose.target[0],
    pose.position[1] - pose.target[1],
    pose.position[2] - pose.target[2],
  );
  const nf = nearFar(d, bounds ? siteDiagonal(bounds) : 1000);
  return { fov: pose.fov_deg, aspect: CAPTURE_ASPECT, near: nf.near, far: nf.far };
}

export interface WaitClock {
  now(): number;
  /** Resolves after `ms`, or at once when `signal` aborts (its timer cleared). */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

const realClock: WaitClock = {
  now: () => performance.now(),
  sleep: (ms, signal) =>
    new Promise((r) => {
      const t = setTimeout(r, ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          r();
        },
        { once: true },
      );
    }),
};

/** The longest wait between two `waitForNodes` steps: about a frame, as the screen loop polls. */
export const WAIT_STEP_MS = 16;
/** The shortest: loads that settle at once (potree-core's are often already settled) must not
 * turn the frozen wait into hundreds of `updatePointClouds` a second (C-G final review m8). */
export const MIN_STEP_MS = 4;

/** Calls `step` (one `updatePointClouds` for the capture camera) until it is not busy (true) or the
 * timeout passes (false), waiting between calls until one of its loads settles or `WAIT_STEP_MS`
 * passes, and never less than `MIN_STEP_MS`. Every wait goes through a timer, never the microtask
 * queue alone: potree-core 2.0.15's `OctreeGeometryNode.load()` returns undefined, so `loads` may be
 * settled already, and a loop that never yields starves the fetches and workers that finish the
 * loads (C-G Task 16). The `WAIT_STEP_MS` timer that loses to the loads is cleared. */
export async function waitForNodes(
  step: () => { busy: boolean; loads: Promise<unknown>[] },
  timeoutMs: number,
  clock: WaitClock = realClock,
): Promise<boolean> {
  const deadline = clock.now() + timeoutMs;
  for (;;) {
    const s = step();
    if (!s.busy) return true;
    if (clock.now() >= deadline) return false;
    const began = clock.now();
    const lost = new AbortController();
    await Promise.race([Promise.allSettled(s.loads), clock.sleep(WAIT_STEP_MS, lost.signal)]);
    lost.abort();
    const spent = clock.now() - began;
    if (spent < MIN_STEP_MS) await clock.sleep(MIN_STEP_MS - spent);
  }
}

interface EncodeCanvas {
  getContext(kind: "2d"): { putImageData(d: ImageData, x: number, y: number): void } | null;
  convertToBlob(o: { type: string; quality?: number }): Promise<Blob>;
}

/** PNG through `OffscreenCanvas.convertToBlob`; JPEG q 0.92 only when the PNG is over 6 MiB. */
export async function encodeView(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  make: (w: number, h: number) => EncodeCanvas = (cw, ch) =>
    new OffscreenCanvas(cw, ch) as unknown as EncodeCanvas,
  imageData: (d: Uint8ClampedArray, w: number, h: number) => ImageData = (d, iw, ih) =>
    new ImageData(d as Uint8ClampedArray<ArrayBuffer>, iw, ih),
): Promise<Blob> {
  const canvas = make(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2D context to encode the view");
  ctx.putImageData(imageData(rgba, w, h), 0, 0);
  const png = await canvas.convertToBlob({ type: "image/png" });
  if (png.size <= VIEW_MAX_BYTES) return png;
  return canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
}

/** The capture's marks as three objects relative to `origin`, for V1's overlay pass. */
export function markObjects(
  marks: readonly CaptureMark[],
  origin: XYZ,
  colours: { accent: THREE.Color; ok: THREE.Color; warn: THREE.Color },
  texture: THREE.Texture,
  fovDeg: number,
  heightPx: number = CAPTURE_HEIGHT,
): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const scale = spriteScale(PIN_SPRITE_PX, heightPx, fovDeg);
  for (const m of marks) {
    if (m.kind === "finding") {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: texture,
          sizeAttenuation: false,
          depthTest: false,
          transparent: true,
        }),
      );
      sprite.position.set(m.at[0] - origin.x, m.at[1] - origin.y, m.at[2] - origin.z);
      sprite.scale.set(scale, scale, 1);
      sprite.renderOrder = 11;
      out.push(sprite);
    } else {
      for (const s of m.shapes) out.push(overlayObject(s, origin, colours[s.tone]));
    }
  }
  return out;
}
