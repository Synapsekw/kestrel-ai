import type * as THREE from "three";
import type { PickParams, PointCloudOctree, Potree } from "potree-core";
import type { Bounds6 } from "./camera";
import type { EdlState } from "./types";

/**
 * The engine as V2's GPU glue sees it (occlusion, capture). `createEngine` builds one literal of
 * this from its own locals, so these modules never reach into the engine closure.
 */
export interface EngineParts {
  readonly renderer: THREE.WebGLRenderer;
  /** V1's overlay pass, drawn after the points; a capture adds its marks here. */
  readonly overlayScene: THREE.Scene;
  /** The engine's overlay group (measure lines, camera glyphs): hidden during a capture. */
  readonly overlay: THREE.Group;
  readonly camera: THREE.PerspectiveCamera;
  readonly potree: Potree;
  readonly canvas: HTMLCanvasElement;
  readonly bounds: Bounds6 | null;
  pco(): PointCloudOctree | null;
  edl(): EdlState;
  /** The canvas background token as 0-255 RGB. */
  clearRgb(): [number, number, number];
  /** The accent token as 0-255 RGB (the finding mark). */
  accentRgb(): [number, number, number];
  /** No animation frame is pending: the view has settled. */
  idle(): boolean;
  frozen(): boolean;
  /** While frozen, the render loop neither updates visibility nor draws. */
  setFrozen(frozen: boolean): void;
  /** The pick params for the current clip box (`clipBox.ts::pickClipParams`). */
  pickParams(): Partial<PickParams>;
  /** Runs a pick render the way the engine's own picks run (V1's `withoutEdl` when it applied it). */
  pickGuard<T>(fn: () => T): T;
  /** V1's `renderToTarget`: points (EDL off, V1 Ruling 3), then the overlay pass, into `target`. */
  renderToTarget(target: THREE.WebGLRenderTarget, cam: THREE.Camera): void;
  requestRender(): void;
}
