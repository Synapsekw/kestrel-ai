import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { screenNearest } from "./screenPick";

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
camera.position.set(0, 0, 10);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();
camera.updateProjectionMatrix();
const rect = { left: 0, top: 0, width: 200, height: 200 };

describe("screenNearest", () => {
  it("returns the point under the pointer", () => {
    expect(screenNearest(new Float32Array([5, 5, 0, 0, 0, 0]), camera, rect, 100, 100)).toBe(1);
  });
  it("returns null when nothing is within 12 px", () => {
    expect(screenNearest(new Float32Array([5, 5, 0]), camera, rect, 100, 100)).toBeNull();
  });
  it("ignores points behind the camera", () => {
    expect(screenNearest(new Float32Array([0, 0, 20]), camera, rect, 100, 100)).toBeNull();
  });
  it("picks the nearer of two points on screen", () => {
    // (0.3, 0, 0) projects ~5 px right of centre; (0, 0, 0) is at the centre
    expect(screenNearest(new Float32Array([0.3, 0, 0, 0, 0, 0]), camera, rect, 101, 100)).toBe(1);
  });
});
