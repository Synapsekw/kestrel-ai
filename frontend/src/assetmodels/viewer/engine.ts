// GLB viewer for asset models (spec 2026-10-02 §8). Factory + on-demand render loop, like the clouds engine.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { disposeChildren } from "@/clouds/viewer/dispose";
import { NoWebGlError } from "@/clouds/viewer/engine";
import { tokenColor, tokenRgb } from "@/clouds/viewer/overlay";

export type ModelView = "top" | "front" | "side" | "iso" | "fit";
export interface ModelPart {
  id: string;
  name: string;
  group: string;
}
export interface ModelEngine {
  /** Rejects on a bad GLB; parts come from node extras. A later `load` replaces (and disposes) the model. */
  load(url: string): Promise<ModelPart[]>;
  setGroupVisible(group: string, visible: boolean): void;
  /** Highlights the part and emits `onSelect`. */
  select(partId: string | null): void;
  /** A vertical clip plane through the axis; null clears it. */
  setCut(bearingDeg: number | null): void;
  /** 1 m elevation rings. */
  setLevels(on: boolean): void;
  /** Hides group "Head". */
  setHeadOff(on: boolean): void;
  /** xyz triples, asset frame. */
  setOverlay(points: Float32Array | null): void;
  setView(view: ModelView): void;
  dispose(): void;
}

/** The camera's look direction per view; matches the backend rasterizer (north is +X, east is +Z). */
export function viewDirection(view: Exclude<ModelView, "fit">): [number, number, number] {
  if (view === "front") return [1, 0, 0];
  if (view === "side") return [0, 0, 1];
  if (view === "top") return [0, -1, 0];
  const n = Math.hypot(1, 0.8, 1);
  return [1 / n, -0.8 / n, 1 / n];
}

// Structural so a test can pass plain objects; the three.js node it really gets carries the glTF extras in userData.
/* eslint-disable @typescript-eslint/no-explicit-any */
export function partsFromScene(
  root: { traverse(cb: (o: any) => void): void },
  /** The part id of a node: its raw glTF name (GLTFLoader strips `.` and friends from `o.name`). */
  idOf: (o: any) => string | undefined = (o) => o.name,
): ModelPart[] {
  const out: ModelPart[] = [];
  root.traverse((o) => {
    const ud = o.userData ?? {};
    const id = idOf(o);
    if (typeof ud.group === "string" && typeof id === "string" && id) {
      out.push({ id, name: typeof ud.name === "string" ? ud.name : id, group: ud.group });
    }
  });
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Top view looks straight down; a hair of tilt keeps the camera's +Y up well defined (north up the screen). */
const TOP_TILT = 0.002;

export function createModelEngine(o: {
  canvas: HTMLCanvasElement;
  host: HTMLElement;
  onSelect?: (partId: string | null) => void;
}): ModelEngine {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: o.canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
  } catch {
    throw new NoWebGlError("WebGL is not available");
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.localClippingEnabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setClearColor(tokenColor(tokenRgb("bg")));
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2f3a, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-8, 16, 10);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 1000);
  camera.up.set(0, 1, 0);
  const controls = new OrbitControls(camera, o.canvas);
  controls.enableDamping = true;
  controls.zoomToCursor = true;
  const modelRoot = new THREE.Group();
  const helpers = new THREE.Group();
  scene.add(modelRoot, helpers);
  const cutPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
  const nodes = new Map<string, THREE.Object3D>();
  const idByNode = new Map<THREE.Object3D, string>();
  const hiddenGroups = new Set<string>();
  let headOff = false;
  let cutBearing: number | null = null;
  let levelsOn = false;
  let selected: string | null = null;
  let bounds = new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
  let raf = 0;
  let idleUntil = 0;
  let disposed = false;
  let loadSeq = 0;

  const frame = () => {
    raf = 0;
    if (disposed) return;
    controls.update();
    renderer.render(scene, camera);
    if (performance.now() < idleUntil) raf = requestAnimationFrame(frame);
  };
  const requestRender = () => {
    if (disposed) return;
    idleUntil = performance.now() + 1000;
    if (!raf) raf = requestAnimationFrame(frame);
  };
  controls.addEventListener("change", requestRender);
  const resize = () => {
    if (disposed) return;
    const w = o.host.clientWidth || 1;
    const h = o.host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    requestRender();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(o.host);
  resize();

  const applyVisibility = () => {
    for (const node of nodes.values()) {
      const group = node.userData.group as string;
      node.visible = !hiddenGroups.has(group) && !(headOff && group === "Head");
    }
    requestRender();
  };
  const applyMaterials = (fn: (m: THREE.Material, id: string) => void) => {
    for (const [id, node] of nodes) {
      node.traverse((c) => {
        const mesh = c as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => fn(m, id));
      });
    }
    requestRender();
  };

  const setView = (view: ModelView) => {
    const size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 0.5);
    const [dx, dy, dz] = viewDirection(view === "fit" ? "iso" : view);
    const dir = new THREE.Vector3(dx, dy, dz);
    if (view === "top") dir.set(Math.sin(TOP_TILT), -Math.cos(TOP_TILT), 0);
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.position.copy(centre).addScaledVector(dir, -dist);
    camera.near = dist / 100;
    camera.far = dist * 10;
    camera.updateProjectionMatrix();
    controls.target.copy(centre);
    controls.update();
    requestRender();
  };

  const applyCut = () => {
    if (cutBearing === null) {
      applyMaterials((m) => {
        m.clippingPlanes = [];
      });
      return;
    }
    const a = THREE.MathUtils.degToRad(cutBearing);
    cutPlane.normal.set(-Math.cos(a), 0, -Math.sin(a)); // keep the half beyond the plane, looking along the bearing
    cutPlane.constant = 0;
    applyMaterials((m) => {
      m.clippingPlanes = [cutPlane];
    });
  };
  const applyHighlight = () =>
    applyMaterials((m, id) => {
      const std = m as THREE.MeshStandardMaterial;
      if (!std.emissive) return;
      std.emissive.setHex(id === selected ? 0x3a1c00 : 0x000000);
    });
  const drawLevels = () => {
    disposeChildren(helpers, (c) => c.userData.kind === "level");
    if (levelsOn) {
      const r = Math.max(bounds.max.x, bounds.max.z, -bounds.min.x, -bounds.min.z, 0.5) * 1.15;
      // --ink is an RGB triple (--line is an rgba() value tokenRgb cannot read); faint, so the rings recede.
      const mat = new THREE.LineBasicMaterial({
        color: tokenColor(tokenRgb("ink")),
        transparent: true,
        opacity: 0.28,
      });
      for (let y = Math.ceil(bounds.min.y); y <= bounds.max.y; y += 1) {
        const pts = Array.from({ length: 97 }, (_, i) => {
          const t = (i / 96) * Math.PI * 2;
          return new THREE.Vector3(r * Math.cos(t), y, r * Math.sin(t));
        });
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
        line.userData.kind = "level";
        helpers.add(line);
      }
    }
    requestRender();
  };

  // click to select a part
  const raycaster = new THREE.Raycaster();
  let downAt: [number, number] | null = null;
  const onDown = (e: PointerEvent) => {
    downAt = [e.clientX, e.clientY];
  };
  const onUp = (e: PointerEvent) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
    downAt = null;
    const rect = o.canvas.getBoundingClientRect();
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    );
    const hit = raycaster.intersectObject(modelRoot, true).find((h) => h.object.visible);
    let n: THREE.Object3D | null = hit?.object ?? null;
    while (n && !idByNode.has(n)) n = n.parent;
    engine.select((n && idByNode.get(n)) ?? null);
  };
  o.canvas.addEventListener("pointerdown", onDown);
  o.canvas.addEventListener("pointerup", onUp);

  const engine: ModelEngine = {
    async load(url) {
      const seq = ++loadSeq;
      const gltf = await new GLTFLoader().loadAsync(url);
      if (disposed || seq !== loadSeq) {
        // dispose() or a newer load() got here first: free what was just parsed, touch nothing live
        const orphan = new THREE.Group();
        orphan.add(gltf.scene);
        disposeChildren(orphan);
        throw new Error(disposed ? "model viewer disposed" : "model load superseded");
      }
      disposeChildren(modelRoot);
      nodes.clear();
      idByNode.clear();
      selected = null;
      modelRoot.add(gltf.scene);
      const { associations, json } = gltf.parser;
      const rawId = (n: THREE.Object3D): string | undefined => {
        const index = associations.get(n)?.nodes;
        const raw = index === undefined ? undefined : (json.nodes?.[index]?.name as string | undefined);
        return raw ?? n.name;
      };
      const parts = partsFromScene(gltf.scene, rawId);
      gltf.scene.traverse((n) => {
        const id = rawId(n);
        if (id && typeof n.userData.group === "string") {
          nodes.set(id, n);
          idByNode.set(n, id);
        }
      });
      // The backend shares one material per material class; give each mesh its own so a highlight stays on its part.
      const originals = new Set<THREE.Material>();
      for (const node of nodes.values()) {
        node.traverse((c) => {
          const mesh = c as THREE.Mesh;
          if (!mesh.isMesh) return;
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => originals.add(m));
            mesh.material = mesh.material.map((m) => m.clone());
          } else {
            originals.add(mesh.material);
            mesh.material = mesh.material.clone();
          }
        });
      }
      originals.forEach((m) => m.dispose());
      applyMaterials((m) => {
        (m as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      });
      bounds = new THREE.Box3().setFromObject(gltf.scene);
      applyCut();
      applyVisibility();
      drawLevels();
      setView("iso");
      return parts;
    },
    setGroupVisible(group, visible) {
      if (visible) hiddenGroups.delete(group);
      else hiddenGroups.add(group);
      applyVisibility();
    },
    select(partId) {
      selected = partId && nodes.has(partId) ? partId : null;
      applyHighlight();
      o.onSelect?.(selected);
    },
    setCut(bearing) {
      cutBearing = bearing;
      applyCut();
    },
    setLevels(on) {
      levelsOn = on;
      drawLevels();
    },
    setHeadOff(on) {
      headOff = on;
      applyVisibility();
    },
    setOverlay(points) {
      disposeChildren(helpers, (c) => c.userData.kind === "overlay");
      if (points && points.length >= 3) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(points, 3));
        const cloud = new THREE.Points(
          geo,
          new THREE.PointsMaterial({
            size: 2,
            sizeAttenuation: false,
            color: tokenColor(tokenRgb("accent")),
          }),
        );
        cloud.userData.kind = "overlay";
        helpers.add(cloud);
      }
      requestRender();
    },
    setView,
    dispose() {
      if (disposed) return;
      disposed = true;
      loadSeq++;
      cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      o.canvas.removeEventListener("pointerdown", onDown);
      o.canvas.removeEventListener("pointerup", onUp);
      controls.removeEventListener("change", requestRender);
      controls.dispose();
      disposeChildren(modelRoot);
      disposeChildren(helpers);
      nodes.clear();
      renderer.dispose();
    },
  };
  return engine;
}
