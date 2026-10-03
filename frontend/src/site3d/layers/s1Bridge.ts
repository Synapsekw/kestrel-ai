import type * as THREE from "three";
import type { SiteEngine } from "@/site3d/engine/SiteEngine";

/** What S2's layers need from S1's engine. The only module that knows S1's accessor names. */
export interface EngineParts {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  requestRender(): void;
}

export function partsOf(e: SiteEngine): EngineParts {
  return {
    renderer: e.renderer,
    scene: e.scene,
    camera: e.camera,
    canvas: e.canvas,
    requestRender: () => e.requestRender(),
  };
}
