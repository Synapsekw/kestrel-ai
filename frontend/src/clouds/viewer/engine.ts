// frontend/src/clouds/viewer/engine.ts
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Potree, PotreeRenderer, VIRIDIS, type PointCloudMaterial, type PointCloudOctree } from "potree-core";
import { isReducedMotion } from "@/ui/motion";
import {
  namedView,
  nearFar,
  orbitStep,
  poseView,
  siteDiagonal,
  topOrtho,
  topView,
  wholeSiteView,
  type Bounds6,
  type View,
  type Vec3 as XYZ,
} from "./camera";
import { classificationLut, type ClassLut } from "./classes";
import { attributeNames, colourAvailability, effectiveColour, intensityRange } from "./colour";
import {
  classifyPixels,
  pushErrorOnce,
  type ColourSample,
  type SnapshotSample,
  type ViewerStats,
} from "./diagnostics";
import { disposeChildren, disposePointsGeometries } from "./dispose";
import { EDL_OPTIONS, EDL_RENDERS_TO_TARGET } from "./edl";
import { FrameRing, frameInterval } from "./frameRing";
import { shouldKeepRendering } from "./idle";
import { makeMaterialOptions, type ColourMode } from "./materialOptions";
import { mouseButtonsFor, resolveNavMode, type AppliedNavMode } from "./navMode";
import { localPositions, tokenColor, tokenRgb, type OverlayShape } from "./overlay";
import { pickAllPoints } from "./pickAll";
import { flipRows, splitHalves } from "./pixels";
import { makeRequestManager, metadataUrl } from "./requestManager";
import { nearestToCentre, topmostWithin } from "./topmost";
import { startTween, tweenAt, type Tween } from "./tween";
import type {
  CameraPose,
  CameraPoseInput,
  ColourAvailability,
  EdlState,
  FrameCallback,
  FrameCamera,
  NavMode,
  ViewName,
} from "./types";
import { deepestLevelAt, pickUncertainty, type NodeBox } from "./uncertainty";

export interface CloudPick {
  x: number;
  y: number;
  z: number;
  level: number;
  uncertainty_m: number;
}

export interface MaterialSettings {
  colour: ColourMode;
  elevationRange: [number, number];
  pointSize: number;
}

export interface EngineEvents {
  /** A measuring tool is armed: hover picks at ≤ 10 Hz. */
  isArmed(): boolean;
  onPick?(p: CloudPick): void;
  onHover?(p: CloudPick | null): void;
  onDoublePick?(p: CloudPick): void;
  /** At most every 250 ms while rendering (S1's status bar). */
  onBar?(b: { pts: number; loading: number }): void;
  /** The octree loaded; which colour modes it can show. */
  onLoaded?(a: ColourAvailability): void;
  onLoadError?(message: string): void;
  onContextLost?(): void;
}

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  /** The element whose size the canvas follows. */
  host: HTMLElement;
  bounds: Bounds6 | null;
  octreeSpacingM: number | null;
  octreeUrl: string;
  token: string;
  budget: number;
  material: MaterialSettings;
  edl: boolean;
  events: EngineEvents;
}

export interface CloudEngine {
  fit(): void;
  topView(): void;
  lookAt(target: XYZ, distance: number): void;
  setView(view: ViewName): void;
  goToPose(pose: CameraPoseInput): void;
  currentPose(): CameraPose;
  setNavMode(mode: NavMode): void;
  navMode(): NavMode;
  setColourMode(mode: ColourMode): void;
  setMaterial(m: MaterialSettings): void;
  setClassVisibility(hidden: ReadonlySet<number>): void;
  colourAvailability(): ColourAvailability | null;
  setBudget(points: number): void;
  setEdl(on: boolean): void;
  edl(): EdlState;
  onFrame(cb: FrameCallback): () => void;
  frameTimes(): number[];
  scriptOrbit(seconds: number, degPerSecond?: number): Promise<void>;
  topSnapshot(px?: number): Promise<ImageBitmap | null>;
  topSnapshotPixels(
    px?: number,
  ): { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> } | null;
  topSnapshotSample(px?: number): SnapshotSample | null;
  renderToTarget(target: THREE.WebGLRenderTarget, cam: THREE.Camera): void;
  pickAtClient(clientX: number, clientY: number): CloudPick | null;
  pickDown(x: number, y: number, radius: number): CloudPick | null;
  project(p: XYZ): { x: number; y: number } | null;
  canvasRect(): { left: number; top: number; right: number; bottom: number } | null;
  setOverlay(key: string, shapes: OverlayShape[]): void;
  overlayKeys(): string[];
  stats(): ViewerStats;
  sampleColours(): ColourSample;
  requestRender(): void;
  dispose(): void;
  /** For C-V2 (clip box, fly, capture): the live objects. Read them; do not replace them. */
  readonly three: {
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    overlayScene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    potree: Potree;
    potreeRenderer: PotreeRenderer;
    pco(): PointCloudOctree | null;
  };
}

/** three could not create a WebGL context (a graphics driver that cannot start it). */
export class NoWebGlError extends Error {}

const HOVER_MS = 100;
const CLICK_SLOP_PX = 4;
const PICK_WINDOW = 15;
/** How far above the cloud's top (and below its bottom) the straight-down pick camera reaches. */
const DOWN_MARGIN_M = 10;
const BAR_MS = 250;

export function emptyStats(): ViewerStats {
  return {
    numVisiblePoints: 0,
    visibleNodes: 0,
    nodesLoading: 0,
    firstPointsMs: null,
    settledMs: null,
    errors: [],
    contextLost: false,
    cameraDistance: 0,
  };
}

const xyz = (v: THREE.Vector3): XYZ => ({ x: v.x, y: v.y, z: v.z });
const tuple = (v: THREE.Vector3): [number, number, number] => [v.x, v.y, v.z];

/**
 * potree-core 2.0.15 + three 0.180.0 for one cloud (spec §7). The cloud sits at its native UTM
 * offset (potree offsets each node), so picks come back in the cloud's native CRS. The loop runs
 * while nodes load, while a tween or scripted orbit runs, or for 1 s after input, then idles.
 */
export function createEngine(o: EngineOptions): CloudEngine {
  const { canvas, host, bounds, events } = o;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  } catch (err) {
    throw new NoWebGlError(err instanceof Error ? err.message : String(err));
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const clear = tokenRgb("bg");
  renderer.setClearColor(tokenColor(clear));
  const scene = new THREE.Scene();
  // Its own pass after the points (plan Ruling 4): with EDL on, layer-0 content of `scene` is drawn
  // before the points and the EDL composite would cover it.
  const overlayScene = new THREE.Scene();
  const overlay = new THREE.Group();
  overlay.renderOrder = 10;
  overlayScene.add(overlay);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 1e6);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, canvas);
  controls.zoomToCursor = true;
  controls.screenSpacePanning = true;
  const potree = new Potree();
  potree.pointBudget = o.budget;
  let edlOn = o.edl;
  const potreeRenderer = new PotreeRenderer({ edl: { enabled: edlOn, ...EDL_OPTIONS } });
  const stats = emptyStats();
  const started = performance.now();
  const diagonal = bounds ? siteDiagonal(bounds) : 1000;
  const frames = new FrameRing();
  const frameCallbacks = new Set<FrameCallback>();
  let material = o.material;
  let availability: ColourAvailability | null = null;
  let intensity: [number, number] | null = null;
  let hiddenClasses: ReadonlySet<number> = new Set();
  let nav: AppliedNavMode = "orbit";
  let tween: Tween | null = null;
  let orbitScript: { until: number; radPerMs: number; resolve: () => void } | null = null;
  let pco: PointCloudOctree | null = null;
  let raf = 0;
  let chained = false;
  let lastTickAt: number | null = null;
  let lastInputAt = started;
  let lastLoadAt = started;
  let lastBarAt = 0;
  let disposed = false;
  const unlisten: Array<() => void> = [];
  const listen = (target: EventTarget, type: string, fn: (ev: Event) => void) => {
    target.addEventListener(type, fn);
    unlisten.push(() => target.removeEventListener(type, fn));
  };

  function drawFrame(cam: THREE.Camera = camera): void {
    potreeRenderer.render({ renderer, scene, camera: cam, pointClouds: pco ? [pco] : [] });
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(overlayScene, cam);
    renderer.autoClear = auto;
  }

  const vp = new THREE.Matrix4();
  const dir = new THREE.Vector3();
  function emitFrame(): void {
    if (frameCallbacks.size === 0) return;
    vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    camera.getWorldDirection(dir);
    const cam: FrameCamera = {
      viewProj: Float64Array.from(vp.elements),
      rect: canvas.getBoundingClientRect(),
      position: tuple(camera.position),
      direction: [dir.x, dir.y, dir.z],
    };
    for (const cb of [...frameCallbacks]) {
      try {
        cb(cam);
      } catch (err) {
        pushErrorOnce(stats.errors, `onFrame: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  function applyView(v: View): void {
    camera.position.set(v.position.x, v.position.y, v.position.z);
    controls.target.set(v.target.x, v.target.y, v.target.z);
    controls.update();
  }

  function currentView(): View {
    return { position: xyz(camera.position), target: xyz(controls.target) };
  }

  /** Instant (S1 fit/topView/lookAt, plan Ruling 5). */
  function jump(v: View): void {
    tween = null;
    applyView(v);
    requestRender();
  }

  /** Tweened; synchronous under reduced motion. */
  function go(to: View): void {
    tween = startTween(currentView(), to, performance.now(), isReducedMotion());
    if (tween.ms === 0) {
      applyView(to);
      tween = null;
    }
    requestRender();
  }

  function sampleIntensity(): void {
    if (!pco || !availability?.intensity) return;
    const arrays: ArrayLike<number>[] = [];
    for (const n of pco.visibleNodes) {
      const a = n.sceneNode?.geometry?.getAttribute("intensity");
      if (a) arrays.push(a.array as ArrayLike<number>);
    }
    intensity = intensityRange(arrays);
    applyMaterial();
  }

  function toClassification(lut: ClassLut): PointCloudMaterial["classification"] {
    const out: Record<string, THREE.Vector4> = {};
    for (const [k, [r, g, b, a]] of Object.entries(lut)) out[k] = new THREE.Vector4(r, g, b, a);
    return out as unknown as PointCloudMaterial["classification"];
  }

  function applyMaterial(): void {
    if (!pco) return;
    const colour = effectiveColour(material.colour, availability);
    const m = makeMaterialOptions({ ...material, colour, intensityRange: intensity ?? undefined });
    // materialOptions.ts spells potree-core's enum values out as numbers (so its test never loads WebGL code)
    type M = PointCloudMaterial; // ColorEncoding itself is not exported from potree-core's index
    pco.material.inputColorEncoding = m.inputColorEncoding as M["inputColorEncoding"];
    pco.material.outputColorEncoding = m.outputColorEncoding as M["outputColorEncoding"];
    pco.material.pointSizeType = m.pointSizeType as M["pointSizeType"];
    pco.material.pointColorType = m.pointColorType as M["pointColorType"];
    pco.material.size = m.size;
    pco.material.elevationRange = m.elevationRange;
    pco.material.intensityRange = m.intensityRange;
    if (colour === "classification")
      pco.material.classification = toClassification(classificationLut(hiddenClasses));
    requestRender();
  }

  const tick = () => {
    raf = 0;
    if (disposed) return;
    const now = performance.now();
    const gap = frameInterval(lastTickAt, now, chained);
    if (gap !== null) frames.push(gap);
    lastTickAt = now;
    if (tween) {
      const s = tweenAt(tween, now);
      applyView(s.view);
      if (s.done) tween = null;
      lastInputAt = now;
    }
    if (orbitScript) {
      const p = orbitStep(xyz(camera.position), xyz(controls.target), orbitScript.radPerMs * (gap ?? 16));
      camera.position.set(p.x, p.y, p.z);
      controls.update();
      lastInputAt = now;
      if (now >= orbitScript.until) {
        const done = orbitScript.resolve;
        orbitScript = null;
        done();
      }
    }
    const distance = camera.position.distanceTo(controls.target);
    const nf = nearFar(distance, diagonal);
    camera.near = nf.near;
    camera.far = nf.far;
    camera.updateProjectionMatrix();
    stats.cameraDistance = distance;
    let pending = 0;
    if (pco) {
      const r = potree.updatePointClouds([pco], camera, renderer);
      // a failed node is reported through nodeLoadFailed below, not as an unhandled rejection;
      // allSettled, because potree-core 2.0.15 also puts undefined entries in this list
      void Promise.allSettled(r.nodeLoadPromises);
      const loading = (pco.pcoGeometry as unknown as { numNodesLoading?: number }).numNodesLoading ?? 0;
      pending = r.nodeLoadPromises.length + (r.exceededMaxLoadsToGPU ? 1 : 0);
      stats.numVisiblePoints = r.numVisiblePoints;
      stats.visibleNodes = r.visibleNodes.length;
      stats.nodesLoading = loading;
      if (loading > 0 || pending > 0) lastLoadAt = now;
      if (stats.firstPointsMs === null && r.visibleNodes.length > 0) stats.firstPointsMs = now - started;
      if (stats.firstPointsMs !== null && stats.settledMs === null && loading === 0 && pending === 0) {
        stats.settledMs = now - started;
        sampleIntensity(); // spec §7: the p2-p98 sample at the first settle
      }
      if (r.nodeLoadFailed) pushErrorOnce(stats.errors, "a node failed to load");
      pending += loading;
    }
    drawFrame();
    emitFrame();
    if (now - lastBarAt > BAR_MS) {
      lastBarAt = now;
      events.onBar?.({ pts: stats.numVisiblePoints, loading: stats.nodesLoading });
    }
    const keep = shouldKeepRendering({
      nodesLoading: stats.nodesLoading,
      pendingLoads: pending,
      lastActivityAt: Math.max(lastInputAt, lastLoadAt),
      now,
      hidden: document.hidden,
    });
    // A requestRender() during this tick (controls' "change", a tween or orbit step) has already
    // scheduled the next frame: never schedule a second one, or two ticks run per frame.
    if (!raf && keep) raf = requestAnimationFrame(tick);
    chained = raf !== 0;
  };

  function requestRender(): void {
    lastInputAt = performance.now();
    if (!raf && !disposed && !document.hidden) {
      chained = false;
      raf = requestAnimationFrame(tick);
    }
  }

  const resize = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    requestRender();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  controls.addEventListener("change", requestRender);
  const onControlsStart = () => {
    tween = null; // a drag wins over a running tween (Review Focus 4)
    requestRender();
  };
  controls.addEventListener("start", onControlsStart);

  // --- picks (S1, moved unchanged) -----------------------------------------------------------
  function nodeBoxes(): NodeBox[] {
    if (!pco) return [];
    const m = pco.matrixWorld;
    return pco.visibleNodes.map((n) => {
      const b = n.boundingBox.clone().applyMatrix4(m);
      return {
        level: n.level,
        min: b.min.toArray() as NodeBox["min"],
        max: b.max.toArray() as NodeBox["max"],
      };
    });
  }
  const rootSpacing = (): number =>
    o.octreeSpacingM ?? (pco?.pcoGeometry as unknown as { spacing?: number })?.spacing ?? 1;
  const toCloudPick = (p: THREE.Vector3): CloudPick => {
    const level = deepestLevelAt(nodeBoxes(), p) ?? 0;
    return { x: p.x, y: p.y, z: p.z, level, uncertainty_m: pickUncertainty(rootSpacing(), level) };
  };

  function pickAtClient(clientX: number, clientY: number): CloudPick | null {
    if (!pco) return null;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    // potree's rule (the drawn point nearest the window centre), over the valid hits only: its own
    // pick answered null on the chimney with 18 points drawn in the window (see pickAllPoints)
    const all = pickAllPoints(pco, renderer, camera, ray.ray, PICK_WINDOW);
    const p = all
      ? nearestToCentre(all)
      : (pco.pick(renderer, camera, ray.ray, { pickWindowSize: PICK_WINDOW })?.position ?? null);
    return p ? toCloudPick(new THREE.Vector3(p.x, p.y, p.z)) : null;
  }

  function pickDown(x: number, y: number, radius: number): CloudPick | null {
    if (!pco || !bounds) return null;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return null;
    // A pixel is the same ground distance both ways and the canvas's shorter side spans 2 x radius,
    // so the pick window (that side, centred on the ray) covers the ±radius square. The depth test
    // keeps the topmost point in each pixel; potree's picker would then return the lit pixel nearest
    // the centre, which over a thin rim is the ground seen past it (§17.10, first acceptance), so
    // every drawn point is read back and `topmostWithin` takes the top surface at the spot.
    const sx = radius * Math.max(w / h, 1);
    const sy = radius * Math.max(h / w, 1);
    const top = bounds[5] + DOWN_MARGIN_M;
    const down = new THREE.OrthographicCamera(-sx, sx, sy, -sy, 0.1, top - bounds[2] + DOWN_MARGIN_M);
    down.up.set(0, 1, 0);
    down.position.set(x, y, top);
    down.lookAt(x, y, bounds[2]);
    down.updateProjectionMatrix();
    down.updateMatrixWorld(true);
    const ray = new THREE.Ray(down.position.clone(), new THREE.Vector3(0, 0, -1));
    const all = pickAllPoints(pco, renderer, down, ray, Math.min(w, h));
    const spacing = rootSpacing();
    const p = all
      ? topmostWithin(
          all.map((hit) => ({ ...hit, reach: pickUncertainty(spacing, hit.level) })),
          x,
          y,
          radius,
        )
      : (pco.pick(renderer, down, ray, { pickWindowSize: Math.min(w, h) })?.position ?? null);
    if (!p || Math.hypot(p.x - x, p.y - y) > radius) return null;
    return toCloudPick(new THREE.Vector3(p.x, p.y, p.z));
  }

  // --- input (S1, moved unchanged) -----------------------------------------------------------
  let down: { x: number; y: number } | null = null;
  let lastHover = 0;
  listen(canvas, "pointerdown", (ev) => {
    const e = ev as PointerEvent;
    down = { x: e.clientX, y: e.clientY };
    requestRender();
  });
  listen(canvas, "pointerup", (ev) => {
    const e = ev as PointerEvent;
    const d = down;
    down = null;
    if (!d || e.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP_PX) return;
    const p = pickAtClient(e.clientX, e.clientY);
    if (p) events.onPick?.(p);
  });
  listen(canvas, "pointermove", (ev) => {
    const e = ev as PointerEvent;
    if (!events.isArmed() || down) return;
    const now = performance.now();
    if (now - lastHover < HOVER_MS) return;
    lastHover = now;
    events.onHover?.(pickAtClient(e.clientX, e.clientY));
  });
  listen(canvas, "dblclick", (ev) => {
    const e = ev as MouseEvent;
    const p = pickAtClient(e.clientX, e.clientY);
    if (!p) return;
    tween = null;
    controls.target.set(p.x, p.y, p.z);
    controls.update();
    events.onDoublePick?.(p);
    requestRender();
  });
  listen(canvas, "webglcontextlost", (ev) => {
    ev.preventDefault();
    stats.contextLost = true;
    pushErrorOnce(stats.errors, "webglcontextlost");
    events.onContextLost?.();
  });
  listen(document, "visibilitychange", () => {
    if (!document.hidden) requestRender();
  });

  potree
    .loadPointCloud(metadataUrl(o.octreeUrl), makeRequestManager(o.token))
    .then((loaded) => {
      if (disposed) {
        disposePointsGeometries(loaded);
        loaded.dispose();
        return;
      }
      loaded.material.gradient = VIRIDIS;
      scene.add(loaded);
      pco = loaded;
      availability = colourAvailability(attributeNames(loaded.pcoGeometry));
      if (bounds) applyView(wholeSiteView(bounds));
      applyMaterial();
      events.onLoaded?.(availability);
      requestRender();
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      pushErrorOnce(stats.errors, `load: ${message}`);
      if (!disposed) events.onLoadError?.(message);
    });

  function renderToTarget(target: THREE.WebGLRenderTarget, cam: THREE.Camera): void {
    const prev = renderer.getRenderTarget();
    const edlWas = edlOn && !EDL_RENDERS_TO_TARGET;
    try {
      if (edlWas) potreeRenderer.setEDL({ enabled: false, ...EDL_OPTIONS });
      renderer.setRenderTarget(target);
      renderer.clear();
      potreeRenderer.render({ renderer, scene, camera: cam, pointClouds: pco ? [pco] : [] });
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(overlayScene, cam);
      renderer.autoClear = auto;
    } finally {
      renderer.setRenderTarget(prev);
      if (edlWas) potreeRenderer.setEDL({ enabled: true, ...EDL_OPTIONS });
    }
  }

  function topSnapshotPixels(
    px = 512,
  ): { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> } | null {
    if (!pco || !bounds) return null;
    const t = topOrtho(bounds, px, DOWN_MARGIN_M);
    const cam = new THREE.OrthographicCamera(
      -t.halfWidth,
      t.halfWidth,
      t.halfHeight,
      -t.halfHeight,
      t.near,
      t.far,
    );
    cam.up.set(0, 1, 0);
    cam.position.set(t.position.x, t.position.y, t.position.z);
    cam.lookAt(t.target.x, t.target.y, t.target.z);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    const target = new THREE.WebGLRenderTarget(t.width, t.height);
    try {
      // the nodes already loaded and visible, no LOD update for this camera (plan Ruling 7)
      renderToTarget(target, cam);
      const buf = new Uint8Array(t.width * t.height * 4);
      renderer.readRenderTargetPixels(target, 0, 0, t.width, t.height, buf);
      return { width: t.width, height: t.height, data: flipRows(buf, t.width, t.height) };
    } finally {
      target.dispose();
      requestRender();
    }
  }

  const engine: CloudEngine = {
    fit() {
      if (bounds) jump(wholeSiteView(bounds));
    },
    topView() {
      if (bounds) jump(topView(bounds));
    },
    lookAt(target, distance) {
      const k = Math.SQRT1_2 * distance;
      jump({ target, position: { x: target.x, y: target.y - k, z: target.z + k } });
    },
    setView(name) {
      if (bounds) go(namedView(name, bounds));
    },
    goToPose(pose) {
      const v = poseView(pose);
      if (!v) return;
      camera.fov = v.fovDeg;
      camera.updateProjectionMatrix();
      go({ position: v.position, target: v.target }); // pose.up is ignored: orbit keeps Z up (Ruling 13)
    },
    currentPose: () => ({
      position: tuple(camera.position),
      target: tuple(controls.target),
      up: tuple(camera.up),
      fov_deg: camera.fov,
    }),
    setNavMode(mode) {
      nav = resolveNavMode(mode, nav);
      const b = mouseButtonsFor(nav);
      controls.mouseButtons = {
        LEFT: b.LEFT as THREE.MOUSE,
        MIDDLE: b.MIDDLE as THREE.MOUSE,
        RIGHT: b.RIGHT as THREE.MOUSE,
      };
    },
    navMode: () => nav,
    setColourMode(mode) {
      material = { ...material, colour: mode };
      applyMaterial();
    },
    setMaterial(m) {
      material = m;
      applyMaterial();
    },
    setClassVisibility(hidden) {
      hiddenClasses = new Set(hidden);
      applyMaterial();
    },
    colourAvailability: () => availability,
    setBudget(points) {
      potree.pointBudget = points;
      requestRender();
    },
    setEdl(on) {
      edlOn = on;
      potreeRenderer.setEDL({ enabled: on, ...EDL_OPTIONS });
      requestRender();
    },
    edl: () => ({ on: edlOn, rendersToTarget: EDL_RENDERS_TO_TARGET }),
    onFrame(cb) {
      frameCallbacks.add(cb);
      return () => {
        frameCallbacks.delete(cb);
      };
    },
    frameTimes: () => frames.values(),
    scriptOrbit(seconds, degPerSecond = 36) {
      return new Promise<void>((resolve) => {
        orbitScript?.resolve();
        orbitScript = {
          until: performance.now() + Math.max(0, seconds) * 1000,
          radPerMs: (degPerSecond * Math.PI) / 180 / 1000,
          resolve,
        };
        requestRender();
      });
    },
    topSnapshot(px = 512) {
      const pix = topSnapshotPixels(px);
      return pix ? createImageBitmap(new ImageData(pix.data, pix.width, pix.height)) : Promise.resolve(null);
    },
    topSnapshotPixels,
    topSnapshotSample(px = 512) {
      const pix = topSnapshotPixels(px);
      if (!pix) return null;
      const { left, right } = splitHalves(pix.data, pix.width, pix.height);
      return {
        width: pix.width,
        height: pix.height,
        left: classifyPixels(left, clear),
        right: classifyPixels(right, clear),
      };
    },
    renderToTarget,
    pickAtClient,
    pickDown,
    project(p) {
      const v = new THREE.Vector3(p.x, p.y, p.z).project(camera);
      if (v.z > 1 || v.z < -1) return null;
      const r = canvas.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    },
    canvasRect() {
      const r = canvas.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    },
    setOverlay(key, shapes) {
      if (!bounds) return;
      const origin = { x: bounds[0], y: bounds[1], z: bounds[2] };
      overlay.position.set(origin.x, origin.y, origin.z);
      disposeChildren(overlay, (c) => c.userData.key === key);
      for (const s of shapes) {
        const color = tokenColor(tokenRgb(s.tone === "accent" ? "accent" : s.tone === "ok" ? "ok" : "warn"));
        const geom = new THREE.BufferGeometry();
        const closed = s.kind === "line" && !!s.closed;
        geom.setAttribute("position", new THREE.BufferAttribute(localPositions(s.points, origin, closed), 3));
        const obj =
          s.kind === "line"
            ? new THREE.Line(
                geom,
                new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }),
              )
            : new THREE.Points(
                geom,
                new THREE.PointsMaterial({ color, size: 8, sizeAttenuation: false, depthTest: false }),
              );
        obj.userData.key = key;
        obj.renderOrder = 10;
        overlay.add(obj);
      }
      requestRender();
    },
    overlayKeys: () => [...new Set(overlay.children.map((c) => String(c.userData.key)))],
    stats: () => ({ ...stats, errors: [...stats.errors] }),
    sampleColours(): ColourSample {
      drawFrame();
      const gl = renderer.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      return classifyPixels(buf, clear);
    },
    requestRender,
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      orbitScript?.resolve();
      orbitScript = null;
      observer.disconnect();
      unlisten.forEach((off) => off());
      controls.removeEventListener("change", requestRender);
      controls.removeEventListener("start", onControlsStart);
      controls.dispose();
      frameCallbacks.clear();
      // the canvas is keyed by the shell's `generation` only: a new cloud reuses this WebGL context,
      // so every buffer this scene made is released here, not left to the context's end
      disposeChildren(overlay);
      if (pco) {
        disposePointsGeometries(pco);
        pco.dispose();
      }
      potreeRenderer.dispose();
      renderer.dispose();
    },
    three: { renderer, scene, overlayScene, camera, controls, potree, potreeRenderer, pco: () => pco },
  };
  return engine;
}
