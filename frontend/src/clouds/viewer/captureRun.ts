import * as THREE from "three";
import type { CloudViewPose } from "@contract/client";
import {
  CAPTURE_HEIGHT,
  CAPTURE_TIMEOUT_MS,
  CAPTURE_WIDTH,
  captureCameraParams,
  encodeView,
  markObjects,
  opaque,
  pinTexture,
  rawColor,
  waitForNodes,
  type CaptureMark,
  type CaptureResult,
} from "./capture";
import { disposeChildren } from "./dispose";
import type { EngineParts } from "./engineParts";
import { tokenRgb } from "./overlay";
import { flipRows } from "./pixels";

const lostError = () => new Error("the 3D view lost its graphics context during the capture");

/**
 * The report view (spec §7 Capture, plan Rulings 5, 6, 8, 14): pause the on-screen loop, load the
 * pose's nodes (or time out), draw the marks and the cloud once into a 1600 × 1000 target through
 * V1's `renderToTarget` (EDL off), read back, restore the screen's nodes, resume, then encode.
 * `notify(true)` at the start and `notify(false)` once the PNG exists (or on failure).
 */
export async function runCapture(
  parts: EngineParts,
  pose: CloudViewPose,
  marks: readonly CaptureMark[],
  opts: { timeoutMs?: number },
  notify: (busy: boolean) => void,
): Promise<CaptureResult> {
  const pco = parts.pco();
  if (!pco) throw new Error("no cloud to capture");
  const { renderer, potree, overlayScene, overlay } = parts;
  if (renderer.getContext().isContextLost()) throw lostError();
  notify(true);
  // Everything from here on (including the GPU-resource setup) is inside the try, so a throw
  // anywhere — plausibly a context loss (spec §14) — still unfreezes the loop and clears the chip
  // instead of leaving the engine permanently frozen with no recovery path.
  const overlayWas = overlay.visible;
  let target: THREE.WebGLRenderTarget | null = null;
  let group: THREE.Group | null = null;
  let texture: THREE.DataTexture | null = null;
  let clearWas: THREE.Color | null = null;
  let clearAlphaWas = 1;
  const pixels = new Uint8Array(CAPTURE_WIDTH * CAPTURE_HEIGHT * 4);
  let complete = false;
  try {
    parts.setFrozen(true);
    target = new THREE.WebGLRenderTarget(CAPTURE_WIDTH, CAPTURE_HEIGHT);
    group = new THREE.Group();
    texture = pinTexture(parts.accentRgb());
    clearWas = renderer.getClearColor(new THREE.Color());
    clearAlphaWas = renderer.getClearAlpha();
    const p = captureCameraParams(pose, parts.bounds);
    const cam = new THREE.PerspectiveCamera(p.fov, p.aspect, p.near, p.far);
    // the contract's arrays are number[], not tuples
    cam.up.set(pose.up[0], pose.up[1], pose.up[2]);
    cam.position.set(pose.position[0], pose.position[1], pose.position[2]);
    cam.lookAt(pose.target[0], pose.target[1], pose.target[2]);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    complete = await waitForNodes(
      () => {
        const r = potree.updatePointClouds([pco], cam, renderer);
        void Promise.allSettled(r.nodeLoadPromises);
        const loading = (pco.pcoGeometry as unknown as { numNodesLoading?: number }).numNodesLoading ?? 0;
        return {
          busy: loading > 0 || r.nodeLoadPromises.length > 0 || r.exceededMaxLoadsToGPU,
          loads: r.nodeLoadPromises,
        };
      },
      opts.timeoutMs ?? CAPTURE_TIMEOUT_MS,
    );
    if (parts.pco() !== pco) throw new Error("the cloud changed during the capture");
    // once more, so the node texture the material reads matches `cam` for the draw
    potree.updatePointClouds([pco], cam, renderer);
    if (parts.bounds) group.position.set(parts.bounds[0], parts.bounds[1], parts.bounds[2]);
    const origin = { x: group.position.x, y: group.position.y, z: group.position.z };
    const colours = {
      accent: rawColor(tokenRgb("accent")),
      ok: rawColor(tokenRgb("ok")),
      warn: rawColor(tokenRgb("warn")),
    };
    for (const o of markObjects(marks, origin, colours, texture, p.fov)) group.add(o);
    overlayScene.add(group);
    overlay.visible = false;
    renderer.setClearColor(rawColor(parts.clearRgb()), 1);
    parts.renderToTarget(target, cam);
    if (renderer.getContext().isContextLost()) throw lostError();
    renderer.readRenderTargetPixels(target, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT, pixels);
  } catch (err) {
    notify(false);
    throw err;
  } finally {
    // Every step here is guarded against what may never have been created (a throw before resource
    // allocation completed leaves the later locals null). The two GPU calls are also each wrapped in
    // their own try/catch: a *second* failure here (also plausible during a lost context) must never
    // replace the real outcome (the error being propagated, or a successful capture) with a cleanup
    // error, and `setFrozen(false)` / `requestRender()` must still run either way.
    try {
      if (clearWas) renderer.setClearColor(clearWas, clearAlphaWas);
    } catch {
      // best-effort restore only; never lets a cleanup failure mask the real outcome
    }
    if (group) {
      overlayScene.remove(group);
      disposeChildren(group);
    }
    texture?.dispose();
    target?.dispose();
    overlay.visible = overlayWas;
    try {
      // the screen camera's nodes again before the loop resumes (plan Ruling 14)
      const now = parts.pco();
      if (now && !renderer.getContext().isContextLost()) potree.updatePointClouds([now], parts.camera, renderer);
    } catch {
      // best-effort restore only; never lets a cleanup failure mask the real outcome
    }
    parts.setFrozen(false);
    parts.requestRender();
  }
  try {
    const blob = await encodeView(opaque(flipRows(pixels, CAPTURE_WIDTH, CAPTURE_HEIGHT)), CAPTURE_WIDTH, CAPTURE_HEIGHT);
    const edl = parts.edl();
    return { blob, width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT, complete, edl: edl.on && edl.rendersToTarget, pose };
  } finally {
    notify(false);
  }
}
