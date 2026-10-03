import * as THREE from "three";
import { vi } from "vitest";
import type { SiteEngine } from "@/site3d/engine/SiteEngine";
import type { SiteLayer } from "@/site3d/layers/types";

/** A SiteEngine stand-in for layer tests: real three objects, no WebGL. Mirrors the real engine's addLayer (same id replaces, old one detached first). */
export function fakeSiteEngine() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1e6);
  const canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  const renderer = { info: { render: { frame: 0 } } } as unknown as THREE.WebGLRenderer;
  const requestRender = vi.fn();
  const layers = new Map<string, SiteLayer>();
  const raw = {
    renderer,
    scene,
    camera,
    canvas,
    requestRender,
    addLayer: vi.fn((l: SiteLayer) => {
      if (layers.has(l.id)) raw.removeLayer(l.id);
      layers.set(l.id, l);
      void l.attach(raw as unknown as SiteEngine);
    }),
    removeLayer: vi.fn((id: string) => {
      layers.get(id)?.detach();
      layers.delete(id);
    }),
  };
  return { engine: raw as unknown as SiteEngine, scene, camera, canvas, renderer, requestRender, layers, raw };
}
