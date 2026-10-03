import type * as THREE from "three";
import type { PointCloudOctree, Potree } from "potree-core";
import { readBudget } from "@/clouds/viewer/budget";
import type { OctreeRequestManager } from "@/clouds/viewer/requestManager";

export type PotreeLike = Pick<Potree, "pointBudget" | "loadPointCloud" | "updatePointClouds">;

/** One Potree for every cloud in the site view: one point budget, one LRU (spec §11: 3 M, a setting). */
export interface CloudHost {
  load(url: string, rm: OctreeRequestManager): Promise<PointCloudOctree>;
  add(p: PointCloudOctree): void;
  remove(p: PointCloudOctree): void;
  budget(): number;
  setBudget(n: number): void;
  /** Once per rendered frame (`frame` = renderer.info.render.frame); true while nodes still load. */
  update(camera: THREE.Camera, renderer: THREE.WebGLRenderer, frame: number): boolean;
}

// potree-core is loaded only when a cloud is placed: tests and cloud-less sites never load it.
const loadPotree = async (): Promise<PotreeLike> => new (await import("potree-core")).Potree();

export function createCloudHost(
  make: () => Promise<PotreeLike> = loadPotree,
  budget = readBudget(),
): CloudHost {
  let potree: Promise<PotreeLike> | null = null;
  let current: PotreeLike | null = null;
  let points = budget;
  const live = new Set<PointCloudOctree>();
  let lastFrame = -1;
  let loading = false;
  const get = () => {
    potree ??= make().then((p) => {
      p.pointBudget = points;
      current = p;
      return p;
    });
    return potree;
  };
  return {
    load: async (url, rm) => (await get()).loadPointCloud(url, rm),
    add: (p) => void live.add(p),
    remove: (p) => void live.delete(p),
    budget: () => points,
    setBudget(n) {
      points = n;
      if (current) current.pointBudget = n;
    },
    update(camera, renderer, frame) {
      if (frame === lastFrame) return loading;
      lastFrame = frame;
      const shown = [...live].filter((p) => p.visible && (p.parent?.visible ?? true));
      if (!current || shown.length === 0) {
        loading = false;
        return false;
      }
      const r = current.updatePointClouds(shown, camera, renderer);
      // a failed node is the octree's own business; allSettled because potree-core also lists undefined
      void Promise.allSettled(r.nodeLoadPromises);
      loading = r.nodeLoadPromises.length > 0 || r.exceededMaxLoadsToGPU;
      return loading;
    },
  };
}
