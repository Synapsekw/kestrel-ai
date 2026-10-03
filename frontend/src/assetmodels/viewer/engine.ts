// GLB viewer for asset models (spec 2026-10-02 §8). Factory + on-demand render loop, like the clouds engine.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { disposeChildren } from "@/clouds/viewer/dispose";
import { NoWebGlError } from "@/clouds/viewer/engine";
import { tokenColor, tokenRgb } from "@/clouds/viewer/overlay";
import { CAMERA_PICK_PX, frustumCorners, nearestOnScreen, pyramidGeometry, type CameraPose } from "./cameras";
import { DEFAULT_FOCUS, focusView, type FocusSettings } from "./focus";
import type { GroundTile } from "./ground";
import { labelAt, parseLabelGrid, parsePatchMesh, type LabelGrid } from "./patch";
import {
  PIN_LIFT_FRACTION,
  liftedPosition,
  pinScale,
  worldPerPixelOrtho,
  worldPerPixelPerspective,
} from "./pins";
import { PatchLoader, frustumOf, type FetchPatch, type PatchBuffers, type PlacementItem } from "./placements";

export interface PickHit {
  kind: "finding" | "camera" | "part";
  id: string;
}
export const GHOST_OPACITY = 0.25;
export const PATCH_ALPHA_TEST = 0.3;
export const PATCH_POLYGON_OFFSET = -4;
export const PATCH_RENDER_ORDER = 3;
export const PIN_RENDER_ORDER = 10;
export const GROUND_RENDER_ORDER = -10;
/**
 * The default for `setAutoRotate(on)` with no speed (U5's Overview hero calls it that way). The unit is
 * three.js OrbitControls' `autoRotateSpeed`: 2.0 is one turn per 30 s at 60 fps, so 0.6 is one turn
 * per 100 s, the kit's value.
 */
export const AUTO_ROTATE_SPEED = 0.6;

export type ModelView = "top" | "front" | "side" | "iso" | "fit";
export interface ModelPart {
  id: string;
  name: string;
  group: string;
}
export interface ModelEngine {
  /**
   * Rejects on a bad GLB; parts come from node extras. A later `load` replaces (and disposes) the model.
   * The first load frames the iso view; `keepCamera` leaves the camera where it is (a new version swapping in).
   */
  load(url: string, opts?: { keepCamera?: boolean }): Promise<ModelPart[]>;
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
  /** Patches as textured meshes (loaded when visible) and pins as 6 px spheres; replaces the last set. */
  setPlacements(items: PlacementItem[], fetchPatch: FetchPatch): void;
  /** One instanced wire pyramid per pose; an empty list clears them. */
  setCameras(poses: CameraPose[], colourOf: (p: CameraPose) => string): void;
  /** Marks one camera; `cone` draws its view frustum out to the target. */
  setSelectedCamera(imageId: string | null, cone: boolean): void;
  /** Orthographic along the patch direction or pin normal; false when the finding has no placement. */
  focusFinding(findingId: string, settings?: FocusSettings): boolean;
  /** Every model material at 0.25 opacity with depth writes off, so findings behind show through. */
  setGhost(on: boolean): void;
  setAutoRotate(on: boolean, speed?: number): void;
  /** Basemap tiles under the model; null removes them. */
  setGround(tiles: GroundTile[] | null): void;
  /** The perspective camera at the photo's pose; null returns to the view before the first pose. */
  viewFromPose(pose: CameraPose | null): void;
  /** Clicks on a finding (patch label or pin), a camera (13 px) or a part. */
  onPick(cb: ((hit: PickHit) => void) | null): void;
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

  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 1e5);
  let active: THREE.PerspectiveCamera | THREE.OrthographicCamera = camera;
  let orthoHeight = 10;
  const surface = new THREE.Group(); // textured patches
  const pins = new THREE.Group();
  const cams = new THREE.Group();
  const ground = new THREE.Group();
  scene.add(surface, pins, cams, ground);
  const textureLoader = new THREE.TextureLoader();
  textureLoader.setCrossOrigin("anonymous");
  let items: PlacementItem[] = [];
  let loader: PatchLoader | null = null;
  let poses: CameraPose[] = [];
  let selectedCam: { id: string | null; cone: boolean } = { id: null, cone: false };
  let ghostOn = false;
  let pickCb: ((hit: PickHit) => void) | null = null;
  let savedView: { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3; fov: number } | null =
    null;
  /** The model's height above the datum, the H of the kit's fractions. */
  const assetHeight = () => Math.max(bounds.max.y - Math.min(bounds.min.y, 0), 1);
  /** Releases textures too: `disposeChildren` frees geometry and materials only. */
  const disposeTextured = (g: THREE.Object3D) => {
    g.traverse((c) => ((c as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined)?.map?.dispose());
    disposeChildren(g);
  };
  const sizeOrtho = (aspect: number) => {
    ortho.top = orthoHeight / 2;
    ortho.bottom = -orthoHeight / 2;
    ortho.left = (-orthoHeight * aspect) / 2;
    ortho.right = (orthoHeight * aspect) / 2;
  };

  const viewportHeight = () => o.host.clientHeight || 1;
  const updatePins = () => {
    const h = viewportHeight();
    for (const p of pins.children) {
      const wpp =
        active === ortho
          ? worldPerPixelOrtho(ortho.top, ortho.bottom, ortho.zoom, h)
          : worldPerPixelPerspective(camera.fov, camera.position.distanceTo(p.position), h);
      p.scale.setScalar(pinScale(wpp, 1));
    }
  };
  const sphere = new THREE.Sphere();
  const requestVisiblePatches = () => {
    if (!loader) return;
    const f = frustumOf(active);
    loader.update(
      items,
      (s) => f.intersectsSphere(sphere.set(new THREE.Vector3(...s.center), s.radius)),
      (c) => active.position.distanceTo(new THREE.Vector3(...c)),
    );
  };
  const frame = () => {
    raf = 0;
    if (disposed) return;
    controls.update();
    updatePins();
    requestVisiblePatches();
    renderer.render(scene, active);
    // auto-rotate keeps the loop alive; otherwise it idles a second after the last change
    if (performance.now() < idleUntil || controls.autoRotate) raf = requestAnimationFrame(frame);
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
    sizeOrtho(w / h);
    ortho.updateProjectionMatrix();
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
    // any preset view leaves the focus and pose views
    active = camera;
    controls.object = camera;
    savedView = null;
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

  const applyGhost = () =>
    applyMaterials((m) => {
      m.transparent = ghostOn;
      m.opacity = ghostOn ? GHOST_OPACITY : 1;
      m.depthWrite = !ghostOn;
      m.needsUpdate = true;
    });

  const addPatch = async (id: string, b: PatchBuffers) => {
    const item = items.find((p) => p.sightingId === id);
    if (!item) return;
    const mesh = parsePatchMesh(b.mesh);
    const labels = parseLabelGrid(b.labels);
    const bitmap = await createImageBitmap(b.texture, { imageOrientation: "flipY" });
    if (disposed || !items.includes(item)) {
      bitmap.close();
      return;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
    g.computeBoundingSphere();
    const tex = new THREE.Texture(bitmap);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.flipY = false; // the bitmap was flipped when it was decoded
    tex.needsUpdate = true;
    const m = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        map: tex,
        alphaTest: PATCH_ALPHA_TEST,
        polygonOffset: true,
        polygonOffsetFactor: PATCH_POLYGON_OFFSET,
        polygonOffsetUnits: PATCH_POLYGON_OFFSET,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    m.renderOrder = PATCH_RENDER_ORDER;
    m.userData = { kind: "patch", findingId: item.findingId, sightingId: id, labels };
    surface.add(m);
    requestRender();
  };

  const drawSelectedCamera = () => {
    disposeChildren(helpers, (c) => c.userData.kind === "camera-selection");
    const p = selectedCam.id ? poses.find((x) => x.imageId === selectedCam.id) : undefined;
    if (!p) return;
    const pos = new THREE.Vector3(...p.position);
    const tgt = new THREE.Vector3(...p.target);
    const group = new THREE.Group();
    group.userData.kind = "camera-selection";
    group.position.copy(pos);
    group.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, tgt, new THREE.Vector3(...p.up)));
    const colour = tokenColor(tokenRgb("accent"));
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(0.1, assetHeight() * 0.004), 12, 8),
      new THREE.MeshBasicMaterial({ color: colour, toneMapped: false }),
    );
    group.add(dot);
    if (selectedCam.cone) {
      const c = frustumCorners(p.hfovDeg, p.vfovDeg, pos.distanceTo(tgt));
      const edges = [
        [0, 1],
        [0, 2],
        [0, 3],
        [0, 4],
        [1, 2],
        [2, 3],
        [3, 4],
        [4, 1],
      ];
      const g = new THREE.BufferGeometry().setFromPoints(
        edges.flatMap(([a, b]) => [new THREE.Vector3(...c[a]), new THREE.Vector3(...c[b])]),
      );
      group.add(
        new THREE.LineSegments(
          g,
          new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: 0.95 }),
        ),
      );
    }
    helpers.add(group);
  };

  // click to pick a finding, a camera or a part
  const raycaster = new THREE.Raycaster();
  /** With the cut on, the half beyond the plane is clipped away: a click picks what is still drawn. */
  const visibleHit = (h: THREE.Intersection) =>
    h.object.visible && (cutBearing === null || cutPlane.distanceToPoint(h.point) >= 0);

  /** Kit pickSurface: a patch counts only where its label grid has a defect and the model is not in front. */
  const pickPlacement = (): PickHit | null => {
    const hits = raycaster.intersectObjects([...surface.children, ...pins.children], false);
    let occluder: number | null = null;
    const slack = (0.035 * assetHeight()) / 80;
    for (const h of hits) {
      const u = h.object.userData as { kind: string; findingId: string | null; labels?: LabelGrid };
      // an ungrouped sighting is not a finding yet: the click falls through to cameras, then parts
      if (u.findingId === null) continue;
      if (u.kind === "patch") {
        if (!h.uv || !u.labels || labelAt(u.labels, h.uv.x, h.uv.y) === 0) continue;
        if (occluder === null)
          occluder = raycaster.intersectObject(modelRoot, true).find(visibleHit)?.distance ?? Infinity;
        if (occluder < h.distance - slack) continue;
      }
      return { kind: "finding", id: u.findingId };
    }
    return null;
  };

  const pickCameraAt = (x: number, y: number, rect: DOMRect): PickHit | null => {
    if (poses.length === 0 || !cams.visible) return null;
    const v = new THREE.Vector3();
    const pts = poses.map((p) => {
      v.set(...p.position).project(active);
      return { id: p.imageId, x: v.x, y: v.y, z: v.z };
    });
    const id = nearestOnScreen(pts, x, y, { width: rect.width, height: rect.height }, CAMERA_PICK_PX);
    return id ? { kind: "camera", id } : null;
  };

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
      active,
    );
    const placed = pickPlacement() ?? pickCameraAt(e.clientX - rect.left, e.clientY - rect.top, rect);
    if (placed) {
      pickCb?.(placed);
      return;
    }
    const hit = raycaster.intersectObject(modelRoot, true).find(visibleHit);
    let n: THREE.Object3D | null = hit?.object ?? null;
    while (n && !idByNode.has(n)) n = n.parent;
    const id = (n && idByNode.get(n)) ?? null;
    engine.select(id);
    if (id) pickCb?.({ kind: "part", id });
  };
  o.canvas.addEventListener("pointerdown", onDown);
  o.canvas.addEventListener("pointerup", onUp);

  const engine: ModelEngine = {
    async load(url, opts) {
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
      applyGhost();
      applyVisibility();
      drawLevels();
      if (opts?.keepCamera) requestRender();
      else setView("iso");
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
    setPlacements(next, fetchPatch) {
      items = next;
      loader?.dispose();
      disposeTextured(surface);
      disposeChildren(pins);
      loader = new PatchLoader(fetchPatch, (id, b) => {
        void addPatch(id, b).catch(() => {
          // a patch that does not parse is left out; the pin list and other patches stay
        });
      });
      const lift = assetHeight() * PIN_LIFT_FRACTION;
      for (const it of next) {
        if (it.kind !== "point") continue;
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(1, 16, 12),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(it.colour), toneMapped: false }),
        );
        m.position.set(...liftedPosition(it.center, it.normal, lift));
        m.renderOrder = PIN_RENDER_ORDER;
        m.userData = { kind: "pin", findingId: it.findingId, sightingId: it.sightingId };
        pins.add(m);
      }
      requestRender();
    },
    setCameras(next, colourOf) {
      disposeChildren(cams);
      poses = next;
      if (next.length > 0) {
        const size = Math.max(0.3, assetHeight() * 0.015);
        const mesh = new THREE.InstancedMesh(
          pyramidGeometry(),
          new THREE.MeshBasicMaterial({ wireframe: true, toneMapped: false }),
          next.length,
        );
        const m = new THREE.Matrix4();
        const look = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const s = new THREE.Vector3(size, size, size);
        const c = new THREE.Color();
        next.forEach((p, i) => {
          const pos = new THREE.Vector3(...p.position);
          q.setFromRotationMatrix(
            look.lookAt(pos, new THREE.Vector3(...p.target), new THREE.Vector3(...p.up)),
          );
          mesh.setMatrixAt(i, m.compose(pos, q, s));
          mesh.setColorAt(i, c.set(colourOf(p)));
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.userData.kind = "cameras";
        cams.add(mesh);
      }
      drawSelectedCamera();
      requestRender();
    },
    setSelectedCamera(imageId, cone) {
      selectedCam = { id: imageId, cone };
      drawSelectedCamera();
      requestRender();
    },
    focusFinding(findingId, settings) {
      // only grouped placements carry a finding id; an ungrouped sighting (null) never matches
      const mine = items.filter((p) => p.findingId !== null && p.findingId === findingId);
      const item = mine.find((p) => p.kind === "patch") ?? mine[0];
      if (!item) return false;
      const fv = focusView(
        { kind: item.kind, center: item.center, normal: item.normal, size: item.size },
        assetHeight(),
        settings ?? DEFAULT_FOCUS,
      );
      controls.autoRotate = false;
      orthoHeight = fv.viewHeight;
      sizeOrtho((o.host.clientWidth || 1) / viewportHeight());
      ortho.zoom = 1;
      const target = new THREE.Vector3(...fv.target);
      ortho.position.copy(target).addScaledVector(new THREE.Vector3(...fv.direction), fv.distance);
      ortho.up.set(0, 1, 0);
      ortho.near = 0.05;
      ortho.far = fv.distance * 2 + assetHeight() * 4;
      ortho.lookAt(target);
      ortho.updateProjectionMatrix();
      active = ortho;
      controls.object = ortho;
      controls.target.copy(target);
      controls.update();
      requestRender();
      return true;
    },
    setGhost(on) {
      ghostOn = on;
      applyGhost();
    },
    setAutoRotate(on, speed) {
      controls.autoRotate = on;
      controls.autoRotateSpeed = speed ?? AUTO_ROTATE_SPEED;
      requestRender();
    },
    setGround(tiles) {
      disposeTextured(ground);
      for (const t of tiles ?? []) {
        const tl = new THREE.Vector3(t.tl[0], t.y, t.tl[1]);
        const tr = new THREE.Vector3(t.tr[0], t.y, t.tr[1]);
        const bl = new THREE.Vector3(t.bl[0], t.y, t.bl[1]);
        const br = tr.clone().add(bl).sub(tl);
        const g = new THREE.BufferGeometry();
        g.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(
            [...tl.toArray(), ...tr.toArray(), ...bl.toArray(), ...br.toArray()],
            3,
          ),
        );
        g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0], 2));
        g.setIndex([0, 2, 1, 1, 2, 3]);
        const tex = textureLoader.load(t.url, requestRender);
        tex.colorSpace = THREE.SRGBColorSpace;
        // Drawn without depth writes: the ground never hides the model, pins or cameras.
        const m = new THREE.Mesh(
          g,
          new THREE.MeshBasicMaterial({
            map: tex,
            transparent: true,
            depthWrite: false,
            toneMapped: false,
            side: THREE.DoubleSide,
          }),
        );
        m.renderOrder = GROUND_RENDER_ORDER;
        m.userData.kind = "ground";
        ground.add(m);
      }
      if (tiles?.length) {
        const reach = Math.max(
          ...tiles.flatMap((t) => [Math.hypot(...t.tl), Math.hypot(...t.tr), Math.hypot(...t.bl)]),
        );
        camera.far = Math.max(camera.far, reach * 4);
        camera.updateProjectionMatrix();
      }
      requestRender();
    },
    viewFromPose(pose) {
      active = camera;
      controls.object = camera;
      if (!pose) {
        if (savedView) {
          camera.position.copy(savedView.position);
          camera.up.copy(savedView.up);
          camera.fov = savedView.fov;
          controls.target.copy(savedView.target);
          savedView = null;
        }
        camera.updateProjectionMatrix();
        controls.update();
        requestRender();
        return;
      }
      if (!savedView) {
        savedView = {
          position: camera.position.clone(),
          target: controls.target.clone(),
          up: camera.up.clone(),
          fov: camera.fov,
        };
      }
      const tgt = new THREE.Vector3(...pose.target);
      camera.position.set(...pose.position);
      camera.up.set(...pose.up);
      camera.fov = pose.vfovDeg;
      camera.near = 0.05;
      camera.far = Math.max(camera.far, camera.position.distanceTo(tgt) * 20);
      camera.lookAt(tgt);
      camera.updateProjectionMatrix();
      controls.target.copy(tgt);
      controls.update();
      requestRender();
    },
    onPick(cb) {
      pickCb = cb;
    },
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
      loader?.dispose();
      disposeTextured(surface);
      disposeTextured(ground);
      disposeChildren(pins);
      disposeChildren(cams);
      renderer.dispose();
    },
  };
  return engine;
}
