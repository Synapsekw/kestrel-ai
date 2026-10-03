import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ISO_DIR, flyDelta, flySpeed, planDir, viewBox } from "./camera";

describe("camera helpers", () => {
  it("viewBox frames a box from a direction at a distance that fits it", () => {
    const box = new THREE.Box3(new THREE.Vector3(-10, 0, -10), new THREE.Vector3(10, 20, 10));
    const v = viewBox(box, new THREE.Vector3(0, 1, 0), 45, 1.5);
    expect(v.target.toArray()).toEqual([0, 10, 0]);
    const radius = Math.sqrt(20 * 20 * 3) / 2;
    expect(v.position.y - 10).toBeCloseTo(radius / Math.sin(THREE.MathUtils.degToRad(22.5)), 6);
  });

  it("a narrow window backs the camera off further", () => {
    const box = new THREE.Box3(new THREE.Vector3(-10, 0, -10), new THREE.Vector3(10, 20, 10));
    const wide = viewBox(box, ISO_DIR, 45, 2).position.distanceTo(new THREE.Vector3(0, 10, 0));
    const narrow = viewBox(box, ISO_DIR, 45, 0.5).position.distanceTo(new THREE.Vector3(0, 10, 0));
    expect(narrow).toBeGreaterThan(wide);
  });

  it("plan view looks down with plant north up the screen", () => {
    const d = planDir();
    expect(d.y).toBeGreaterThan(0.99);
    expect(d.x).toBeLessThan(0); // the camera sits a hair south, so +X (north) is screen-up
  });

  it("fly: W moves along the view, D strafes east when facing north, E rises", () => {
    const north = new THREE.Vector3(1, 0, 0);
    expect(flyDelta(new Set(["KeyW"]), north, 2, 0.5).toArray()).toEqual([1, 0, 0]);
    const d = flyDelta(new Set(["KeyD"]), north, 1, 1);
    expect(d.z).toBeCloseTo(1, 9);
    expect(flyDelta(new Set(["KeyE"]), north, 1, 1).y).toBeCloseTo(1, 9);
    expect(flyDelta(new Set(), north, 1, 1).length()).toBe(0);
  });

  it("fly speed is a quarter of the distance, clamped, ×4 with Shift", () => {
    expect(flySpeed(40, 1000, false)).toBe(10);
    expect(flySpeed(0.1, 1000, false)).toBe(0.25);
    expect(flySpeed(5000, 1000, true)).toBe(1000);
  });
});
