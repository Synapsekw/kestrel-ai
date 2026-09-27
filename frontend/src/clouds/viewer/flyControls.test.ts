import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FLY_EXIT_AHEAD_M, FlyControls, anglesOf, flySpeed, forwardOf, look, moveDirection } from "./flyControls";

function key(type: "keydown" | "keyup", code: string, init: KeyboardEventInit = {}, target: EventTarget = window) {
  target.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true, ...init }));
}

function mouseMove(dx: number, dy: number) {
  const ev = new MouseEvent("mousemove", { bubbles: true });
  Object.defineProperty(ev, "movementX", { value: dx });
  Object.defineProperty(ev, "movementY", { value: dy });
  document.dispatchEvent(ev);
}

describe("fly maths", () => {
  it("speed is clamp(distance, 1, diagonal) / 4, times 4 with Shift", () => {
    expect(flySpeed(40, 1000, false)).toBe(10);
    expect(flySpeed(40, 1000, true)).toBe(40);
    expect(flySpeed(0.2, 1000, false)).toBe(0.25);
    expect(flySpeed(5000, 1000, false)).toBe(250);
  });

  it("forward and angles round-trip; yaw is CCW from +x, pitch above the horizon", () => {
    const f = forwardOf(Math.PI / 2, 0);
    expect(f.x).toBeCloseTo(0, 12);
    expect(f.y).toBeCloseTo(1, 12);
    const a = anglesOf(new THREE.Vector3(1, 1, Math.SQRT2));
    expect(a.yaw).toBeCloseTo(Math.PI / 4, 12);
    expect(a.pitch).toBeCloseTo(Math.PI / 4, 12);
  });

  it("mouse right turns right, mouse down looks down, pitch stops at 89°", () => {
    const r = look(Math.PI / 2, 0, 100, 0);
    expect(r.yaw).toBeLessThan(Math.PI / 2);
    expect(look(0, 0, 0, 50).pitch).toBeLessThan(0);
    expect(look(0, 0, 0, -1e6).pitch).toBeCloseTo((89 * Math.PI) / 180, 12);
  });

  it("W along the view, D strafes right horizontally, E goes up world Z", () => {
    const north = Math.PI / 2;
    expect(moveDirection(new Set(["KeyW"]), north, 0).toArray()).toEqual([
      expect.closeTo(0, 12),
      expect.closeTo(1, 12),
      expect.closeTo(0, 12),
    ]);
    const d = moveDirection(new Set(["KeyD"]), north, 0.5);
    expect(d.x).toBeCloseTo(1, 12);
    expect(d.z).toBeCloseTo(0, 12);
    expect(moveDirection(new Set(["KeyE"]), north, 0).z).toBeCloseTo(1, 12);
    expect(moveDirection(new Set(), north, 0).length()).toBe(0);
  });
});

describe("FlyControls", () => {
  let camera: THREE.PerspectiveCamera;
  let canvas: HTMLCanvasElement;
  let fly: FlyControls;
  const requestRender = vi.fn();

  beforeEach(() => {
    camera = new THREE.PerspectiveCamera(60, 1, 0.05, 1e6);
    camera.up.set(0, 0, 1);
    camera.position.set(0, -40, 0);
    camera.lookAt(0, 0, 0);
    canvas = document.createElement("canvas");
    document.body.append(canvas);
    fly = new FlyControls({ camera, element: canvas, siteDiagonal: 1000, requestRender });
    fly.enable([0, 0, 0]);
  });

  afterEach(() => {
    if (fly.isEnabled) fly.disable();
    canvas.remove();
    requestRender.mockReset();
  });

  it("moves while W is held, capped at 0.1 s per frame, and keeps the loop alive only while held", () => {
    expect(fly.active()).toBe(false);
    key("keydown", "KeyW");
    expect(fly.active()).toBe(true);
    expect(requestRender).toHaveBeenCalled();
    fly.update(0); // first frame: no elapsed time
    fly.update(100); // 0.1 s at clamp(40)/4 = 10 m/s
    expect(camera.position.y).toBeCloseTo(-39, 9);
    fly.update(5_100); // a 5 s stall still moves only 0.1 s worth (39 m away: 9.75 m/s)
    expect(camera.position.y).toBeCloseTo(-38.025, 9);
    key("keyup", "KeyW");
    expect(fly.active()).toBe(false);
    expect(fly.update(5_200)).toBe(false);
  });

  it("Shift flies four times faster; Q goes down", () => {
    key("keydown", "KeyW", { shiftKey: true });
    fly.update(0);
    fly.update(100);
    expect(camera.position.y).toBeCloseTo(-36, 9);
    key("keyup", "KeyW", { shiftKey: true });
    key("keydown", "KeyQ");
    fly.update(1_000);
    fly.update(1_100);
    expect(camera.position.z).toBeLessThan(0);
  });

  it("ignores keys typed into a text field and chords with Ctrl", () => {
    const input = document.createElement("input");
    document.body.append(input);
    key("keydown", "KeyW", {}, input);
    expect(fly.active()).toBe(false);
    const ctrl = new KeyboardEvent("keydown", { code: "KeyS", ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(ctrl);
    expect(fly.active()).toBe(false);
    expect(ctrl.defaultPrevented).toBe(false);
    input.remove();
  });

  it("consumes its own keys so the keymap skips them", () => {
    const ev = new KeyboardEvent("keydown", { code: "KeyA", bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    const other = new KeyboardEvent("keydown", { code: "KeyM", bubbles: true, cancelable: true });
    window.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
  });

  it("losing focus releases every key", () => {
    key("keydown", "KeyW");
    window.dispatchEvent(new Event("blur"));
    expect(fly.active()).toBe(false);
  });

  it("mouse look under pointer lock turns without roll", () => {
    Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => canvas });
    mouseMove(200, 80);
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    expect(dir.x).toBeGreaterThan(0); // turned right (east) from north
    expect(dir.z).toBeLessThan(0); // looked down
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    expect(right.z).toBeCloseTo(0, 9); // no roll
    Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => null });
  });

  it("asks for pointer lock on a left press on the canvas", () => {
    const lock = vi.fn();
    (canvas as unknown as { requestPointerLock: () => void }).requestPointerLock = lock;
    canvas.dispatchEvent(new MouseEvent("pointerdown", { button: 0, bubbles: true }));
    expect(lock).toHaveBeenCalled();
  });

  it("ahead() is 10 m along the view without leaving fly mode", () => {
    const a = fly.ahead();
    expect(a[1]).toBeCloseTo(-30, 9);
    expect(fly.isEnabled).toBe(true);
  });

  it("leaving sets the orbit target 10 m ahead and stops listening", () => {
    const target = fly.disable();
    expect(target[0]).toBeCloseTo(0, 9);
    expect(target[1]).toBeCloseTo(-40 + FLY_EXIT_AHEAD_M, 9);
    key("keydown", "KeyW");
    expect(fly.active()).toBe(false);
  });
});
