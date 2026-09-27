import * as THREE from "three";
import { isTypingTarget } from "@/ui/keymap";
import type { Vec3 } from "./types";

/** Leaving fly mode puts the orbit target this far ahead of the camera (spec §7). */
export const FLY_EXIT_AHEAD_M = 10;
export const FLY_SHIFT_FACTOR = 4;
export const FLY_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE"]);
const LOOK_RAD_PER_PX = 0.0025;
const PITCH_LIMIT = (89 * Math.PI) / 180;
const MAX_STEP_S = 0.1;
const UP = new THREE.Vector3(0, 0, 1);

/** `clamp(distanceToTarget, 1, siteDiagonal) / 4` m/s, × 4 with Shift (spec §7). */
export function flySpeed(distanceToTarget: number, siteDiagonal: number, shift: boolean): number {
  const d = Math.min(Math.max(distanceToTarget, 1), Math.max(siteDiagonal, 1));
  return (d / 4) * (shift ? FLY_SHIFT_FACTOR : 1);
}

/** Yaw: radians counter-clockwise from +x in the XY plane; pitch: radians above the horizon. */
export function forwardOf(yaw: number, pitch: number): THREE.Vector3 {
  return new THREE.Vector3(Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch));
}

export function anglesOf(dir: THREE.Vector3): { yaw: number; pitch: number } {
  const d = dir.clone().normalize();
  return { yaw: Math.atan2(d.y, d.x), pitch: Math.asin(Math.max(-1, Math.min(1, d.z))) };
}

/** Mouse right turns right (yaw decreases), mouse down looks down; pitch is clamped to ±89°. */
export function look(yaw: number, pitch: number, dx: number, dy: number): { yaw: number; pitch: number } {
  const p = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch - dy * LOOK_RAD_PER_PX));
  return { yaw: yaw - dx * LOOK_RAD_PER_PX, pitch: p };
}

/** The unit direction the held keys ask for (zero when none): W/S along the view, A/D strafe
 * horizontally, E/Q along world Z. */
export function moveDirection(held: ReadonlySet<string>, yaw: number, pitch: number): THREE.Vector3 {
  const f = forwardOf(yaw, pitch);
  const r = new THREE.Vector3().crossVectors(f, UP).normalize();
  const v = new THREE.Vector3();
  if (held.has("KeyW")) v.add(f);
  if (held.has("KeyS")) v.sub(f);
  if (held.has("KeyD")) v.add(r);
  if (held.has("KeyA")) v.sub(r);
  if (held.has("KeyE")) v.add(UP);
  if (held.has("KeyQ")) v.sub(UP);
  return v.lengthSq() > 0 ? v.normalize() : v;
}

export interface FlyOptions {
  camera: THREE.PerspectiveCamera;
  /** The canvas: a left press on it asks for pointer lock. */
  element: HTMLElement;
  siteDiagonal: number;
  requestRender(): void;
}

/**
 * Fly navigation (spec §7): pointer-lock mouse look with no roll, WASD/QE movement. The engine calls
 * `update(now)` once per frame and keeps its loop alive while `active()` (a movement key is held).
 * three's FlyControls was rejected because it rolls.
 */
export class FlyControls {
  private readonly held = new Set<string>();
  private shift = false;
  private yaw = 0;
  private pitch = 0;
  private readonly target = new THREE.Vector3();
  private enabled = false;
  private dragging = false;
  private lastAt: number | null = null;

  constructor(private readonly o: FlyOptions) {}

  get isEnabled(): boolean {
    return this.enabled;
  }

  enable(orbitTarget: Vec3): void {
    if (this.enabled) return;
    this.enabled = true;
    this.target.set(...orbitTarget);
    const dir = new THREE.Vector3();
    this.o.camera.getWorldDirection(dir);
    ({ yaw: this.yaw, pitch: this.pitch } = anglesOf(dir));
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
    this.orient();
    window.addEventListener("keydown", this.onKeyDown, true);
    window.addEventListener("keyup", this.onKeyUp, true);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("pointerup", this.onPointerUp);
    this.o.element.addEventListener("pointerdown", this.onPointerDown);
    document.addEventListener("mousemove", this.onMouseMove);
  }

  /** Stops flying and answers the new orbit target, 10 m ahead of the camera. */
  disable(): Vec3 {
    this.enabled = false;
    this.held.clear();
    this.dragging = false;
    this.lastAt = null;
    window.removeEventListener("keydown", this.onKeyDown, true);
    window.removeEventListener("keyup", this.onKeyUp, true);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.o.element.removeEventListener("pointerdown", this.onPointerDown);
    document.removeEventListener("mousemove", this.onMouseMove);
    if (document.pointerLockElement === this.o.element) document.exitPointerLock?.();
    return this.ahead();
  }

  /** The point 10 m ahead of the camera: the orbit target leaving fly mode sets (and the target
   * `currentPose()` answers while flying). */
  ahead(): Vec3 {
    const a = this.o.camera.position
      .clone()
      .addScaledVector(forwardOf(this.yaw, this.pitch), FLY_EXIT_AHEAD_M);
    return [a.x, a.y, a.z];
  }

  /** A movement key is held: the engine keeps its render loop running. */
  active(): boolean {
    return this.enabled && this.held.size > 0;
  }

  /** Moves the camera for the time since the previous frame (at most 0.1 s); true when it moved. */
  update(nowMs: number): boolean {
    if (!this.active()) {
      this.lastAt = null;
      return false;
    }
    const dt = this.lastAt === null ? 0 : Math.min(Math.max((nowMs - this.lastAt) / 1000, 0), MAX_STEP_S);
    this.lastAt = nowMs;
    const cam = this.o.camera;
    const speed = flySpeed(cam.position.distanceTo(this.target), this.o.siteDiagonal, this.shift);
    cam.position.addScaledVector(moveDirection(this.held, this.yaw, this.pitch), speed * dt);
    this.orient();
    return dt > 0;
  }

  private orient(): void {
    const cam = this.o.camera;
    cam.up.copy(UP);
    cam.lookAt(cam.position.clone().add(forwardOf(this.yaw, this.pitch)));
    cam.updateMatrixWorld();
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
    this.shift = e.shiftKey;
    if (!FLY_KEYS.has(e.code)) return;
    e.preventDefault();
    this.held.add(e.code);
    this.o.requestRender();
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.shift = e.shiftKey;
    if (this.held.delete(e.code)) e.preventDefault();
  };

  private readonly onBlur = () => {
    this.held.clear();
  };

  private readonly onPointerDown = (e: PointerEvent | MouseEvent) => {
    if (e.button !== 0) return;
    this.dragging = true;
    const el = this.o.element as HTMLElement & { requestPointerLock?: () => unknown };
    if (typeof el.requestPointerLock !== "function") return;
    try {
      const r = el.requestPointerLock();
      // Chromium answers a promise; a refused lock keeps the drag-look fallback
      if (r && typeof (r as Promise<void>).catch === "function") (r as Promise<void>).catch(() => {});
    } catch {
      // the drag-look fallback stays
    }
  };

  private readonly onPointerUp = () => {
    this.dragging = false;
  };

  private readonly onMouseMove = (e: MouseEvent) => {
    if (!this.enabled) return;
    if (document.pointerLockElement !== this.o.element && !this.dragging) return;
    ({ yaw: this.yaw, pitch: this.pitch } = look(this.yaw, this.pitch, e.movementX ?? 0, e.movementY ?? 0));
    this.orient();
    this.o.requestRender();
  };
}
