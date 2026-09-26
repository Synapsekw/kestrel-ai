import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { disposeChildren, disposePointsGeometries } from "./dispose";

function line() {
  return new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
}

describe("GPU resource release", () => {
  it("removes the matching children and disposes their geometry and material", () => {
    const group = new THREE.Group();
    const keep = line();
    keep.userData.key = "pin";
    const drop = line();
    drop.userData.key = "measure";
    const dot = new THREE.Points(new THREE.BufferGeometry(), [
      new THREE.PointsMaterial(),
      new THREE.PointsMaterial(),
    ]);
    dot.userData.key = "measure";
    group.add(keep, drop, dot);
    const spies = [
      vi.spyOn(drop.geometry, "dispose"),
      vi.spyOn(drop.material as THREE.Material, "dispose"),
      vi.spyOn(dot.geometry, "dispose"),
      ...(dot.material as THREE.Material[]).map((m) => vi.spyOn(m, "dispose")),
    ];
    const keepGeom = vi.spyOn(keep.geometry, "dispose");

    disposeChildren(group, (c) => c.userData.key === "measure");

    expect(group.children).toEqual([keep]);
    for (const s of spies) expect(s).toHaveBeenCalledOnce();
    expect(keepGeom).not.toHaveBeenCalled();
  });

  it("disposes everything when no filter is given", () => {
    const group = new THREE.Group();
    const a = line();
    const g = vi.spyOn(a.geometry, "dispose");
    const m = vi.spyOn(a.material as THREE.Material, "dispose");
    group.add(a);
    disposeChildren(group);
    expect(group.children).toHaveLength(0);
    expect(g).toHaveBeenCalledOnce();
    expect(m).toHaveBeenCalledOnce();
  });

  it("disposes every Points geometry under a tree, the root node's included", () => {
    const root = new THREE.Object3D();
    const rootPoints = new THREE.Points(new THREE.BufferGeometry());
    const child = new THREE.Points(new THREE.BufferGeometry());
    rootPoints.add(child);
    root.add(rootPoints);
    const material = vi.spyOn(rootPoints.material as THREE.Material, "dispose");
    const a = vi.spyOn(rootPoints.geometry, "dispose");
    const b = vi.spyOn(child.geometry, "dispose");
    disposePointsGeometries(root);
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    // the octree's shared PointCloudMaterial is potree-core's to dispose
    expect(material).not.toHaveBeenCalled();
  });
});
