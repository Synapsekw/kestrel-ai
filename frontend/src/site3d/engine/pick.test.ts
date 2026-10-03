import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Pickable } from "../layers/types";
import { pickFirst } from "./pick";

function box(id: string, x: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  m.position.set(x, 0, 0);
  m.userData = { id };
  return m;
}

function pickable(root: THREE.Object3D, extra: Partial<Pickable> = {}): Pickable {
  return {
    layerId: "model",
    root,
    resolve: (o) =>
      typeof o.userData.id === "string" ? { itemId: o.userData.id, extras: { ...o.userData } } : null,
    ...extra,
  };
}

const ray = () => {
  const r = new THREE.Raycaster();
  r.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0));
  return r;
};

describe("pickFirst", () => {
  it("returns the nearest resolvable hit", () => {
    const root = new THREE.Group();
    root.add(box("far", 20), box("near", 10));
    root.updateMatrixWorld(true);
    const hit = pickFirst(ray(), [pickable(root)]);
    expect(hit?.itemId).toBe("near");
    expect(hit?.layerId).toBe("model");
    expect(hit?.point[0]).toBeCloseTo(9, 6);
  });

  it("skips hidden objects and points the layer refuses (a cut)", () => {
    const root = new THREE.Group();
    const near = box("near", 10);
    root.add(box("far", 20), near);
    root.updateMatrixWorld(true);
    near.visible = false;
    expect(pickFirst(ray(), [pickable(root)])?.itemId).toBe("far");
    near.visible = true;
    expect(pickFirst(ray(), [pickable(root, { accepts: (p) => p.x > 15 })])?.itemId).toBe("far");
  });

  it("an unresolvable hit falls through to the next one; nothing is null", () => {
    const root = new THREE.Group();
    const bare = box("x", 10);
    bare.userData = {};
    root.add(bare, box("far", 20));
    root.updateMatrixWorld(true);
    expect(pickFirst(ray(), [pickable(root)])?.itemId).toBe("far");
    expect(pickFirst(ray(), [])).toBeNull();
  });
});
