// frontend/src/clouds/viewer/types.ts
/** The engine's public shapes (spec §7; controller ruling 4). Every C unit imports them from here. */
export type { ColourMode } from "./materialOptions";

/** A point or a direction in the cloud's native CRS, metres. (camera.ts's `{x, y, z}` Vec3 is S1's.) */
export type Vec3 = [number, number, number];

/** What the frame hook hands each subscriber after a render. */
export interface FrameCamera {
  /** projection × view, column-major (three's `Matrix4.elements` order), 16 numbers. */
  viewProj: Float64Array | number[];
  /** The canvas in client coordinates. */
  rect: DOMRect;
  position: Vec3;
  /** Unit vector the camera looks along. */
  direction: Vec3;
}

export type FrameCallback = (cam: FrameCamera) => void;

/** "fly" is typed now and applied by C-V2; V1 ignores it (plan Ruling 2). */
export type NavMode = "orbit" | "pan" | "fly";

export type ViewName = "top" | "front" | "side" | "iso" | "fit";

/** A camera placement; structurally assignable to C-C0's `CloudViewPose`. */
export interface CameraPose {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  /** Vertical field of view in degrees. */
  fov_deg: number;
}

/**
 * What `goToPose` accepts: a `CameraPose`, or C-C0's stored `CloudViewPose` (`number[]` fields) as is.
 * `poseView` checks the lengths and values; an invalid pose is ignored.
 */
export interface CameraPoseInput {
  position: readonly number[];
  target: readonly number[];
  up: readonly number[];
  fov_deg: number;
}

export interface ColourAvailability {
  rgb: boolean;
  elevation: true;
  intensity: boolean;
  classification: boolean;
}

export interface EdlState {
  on: boolean;
  /** False in potree-core 2.0.15: EDL always composites to the canvas (plan Ruling 3). */
  rendersToTarget: boolean;
}
