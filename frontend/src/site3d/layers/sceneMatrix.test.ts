import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { siteToScene } from "@/site3d/engine/siteTransform";
import { FRAME } from "@/test/siteSceneFixtures";
import { siteToSceneMatrix } from "./sceneMatrix";

describe("siteToSceneMatrix", () => {
  it("maps site points exactly like siteToScene, with the cloud's z offset", () => {
    const m = siteToSceneMatrix(FRAME, 120.45);
    const pts: [number, number, number][] = [
      [244338.089, 3179515.69, -20.45],
      [244900.5, 3180120.25, 3.2],
      [243800, 3179000, -45],
    ];
    for (const [x, y, z] of pts) {
      const v = new THREE.Vector3(x, y, z).applyMatrix4(m);
      const [ex, ey, ez] = siteToScene(FRAME, x, y, z + 120.45);
      expect(v.x).toBeCloseTo(ex, 5);
      expect(v.y).toBeCloseTo(ey, 5);
      expect(v.z).toBeCloseTo(ez, 5);
    }
  });

  it("puts the plant origin at the cloud's datum height at the scene origin", () => {
    const v = new THREE.Vector3(244338.089, 3179515.69, -20.45).applyMatrix4(
      siteToSceneMatrix(FRAME, 120.45),
    );
    expect(v.length()).toBeLessThan(1e-5);
  });

  it("is a rotation (no scale, no mirror)", () => {
    expect(siteToSceneMatrix(FRAME, 0).determinant()).toBeCloseTo(1, 9);
  });
});
