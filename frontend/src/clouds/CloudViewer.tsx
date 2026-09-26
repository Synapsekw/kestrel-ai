import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Potree, VIRIDIS, type PointCloudMaterial, type PointCloudOctree } from "potree-core";
import type { PointCloud } from "@/api/clouds";
import { Alert, Button } from "@/ui";
import { nearFar, siteDiagonal, topView, wholeSiteView, type Bounds6, type Vec3 } from "./viewer/camera";
import {
  classifyPixels,
  diagnosticsEnabled,
  installHook,
  pushErrorOnce,
  type ColourSample,
  type ViewerStats,
} from "./viewer/diagnostics";
import { disposeChildren, disposePointsGeometries } from "./viewer/dispose";
import { shouldKeepRendering } from "./viewer/idle";
import { makeMaterialOptions, type ColourMode } from "./viewer/materialOptions";
import { localPositions, tokenColor, tokenRgb, type OverlayShape } from "./viewer/overlay";
import { pickAllPoints } from "./viewer/pickAll";
import { makeRequestManager, metadataUrl } from "./viewer/requestManager";
import { nearestToCentre, topmostWithin } from "./viewer/topmost";
import { deepestLevelAt, pickUncertainty, type NodeBox } from "./viewer/uncertainty";

export interface CloudPick {
  x: number;
  y: number;
  z: number;
  level: number;
  uncertainty_m: number;
}

export interface CloudViewerHandle {
  fit(): void;
  topView(): void;
  lookAt(target: Vec3, distance: number): void;
  pickAtClient(clientX: number, clientY: number): CloudPick | null;
  /**
   * The top surface within `radius` m (horizontally) of (x, y), at its loaded point nearest the spot
   * (`topmostWithin`): potree's picker run with an orthographic camera above the cloud looking
   * straight down, so the answer does not depend on the current view (no viewport clamping, no
   * horizontal error), then every point it drew read back and compared.
   */
  pickDown(x: number, y: number, radius: number): CloudPick | null;
  /** Client (viewport) coordinates of a native-CRS point, or null behind the camera; may be off the canvas. */
  project(p: Vec3): { x: number; y: number } | null;
  /** The canvas in client coordinates, or null before it exists. */
  canvasRect(): { left: number; top: number; right: number; bottom: number } | null;
  setOverlay(key: string, shapes: OverlayShape[]): void;
  stats(): ViewerStats;
}

export interface CloudViewerProps {
  cloud: PointCloud;
  octreeUrl: string;
  token: string;
  budget: number;
  colour: ColourMode;
  elevationRange: [number, number];
  pointSize: number;
  /** A measuring tool is armed: hover picks at ≤ 10 Hz with a cursor marker. */
  armed?: boolean;
  onPick?(p: CloudPick): void;
  onHover?(p: CloudPick | null): void;
  onDoublePick?(p: CloudPick): void;
}

const HOVER_MS = 100;
const CLICK_SLOP_PX = 4;
const PICK_WINDOW = 15;
/** How far above the cloud's top (and below its bottom) the straight-down pick camera reaches. */
const DOWN_MARGIN_M = 10;
const fmt = (v: number) => v.toFixed(3);
const points = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });

interface Engine {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  potree: Potree;
  overlay: THREE.Group;
  pco: PointCloudOctree | null;
  stats: ViewerStats;
  requestRender(): void;
}

function emptyStats(): ViewerStats {
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

/**
 * potree-core 2.0.15 + three 0.180.0 in a React component (spec §8). One cloud; the render loop
 * runs while nodes load or for 1 s after input, then idles. The cloud sits at its native UTM offset
 * (potree offsets each node), so picks come back in the cloud's native CRS.
 */
export const CloudViewer = forwardRef<CloudViewerHandle, CloudViewerProps>(function CloudViewer(props, ref) {
  const { cloud, octreeUrl, token, budget, colour, elevationRange, pointSize, armed = false } = props;
  const box = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = useRef<Engine | null>(null);
  const callbacks = useRef({
    onPick: props.onPick,
    onHover: props.onHover,
    onDoublePick: props.onDoublePick,
    armed,
  });
  const [generation, setGeneration] = useState(0);
  // Keyed by the scene they belong to, so a new cloud or a "Reload view" clears them without a
  // synchronous setState in the effect (react-hooks `set-state-in-effect`).
  const sceneKey = `${cloud.id}|${octreeUrl}|${generation}`;
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);
  const [lostKey, setLostKey] = useState<string | null>(null);
  const [noWebGlKey, setNoWebGlKey] = useState<string | null>(null);
  const [bar, setBar] = useState<{ pts: number; loading: number; pick: CloudPick | null }>({
    pts: 0,
    loading: 0,
    pick: null,
  });
  const bounds = cloud.bounds_native as Bounds6 | null;
  // Read by the scene effect's `applyMaterial`, so a colour/size change never rebuilds the scene.
  const materialRef = useRef({ colour, elevationRange, pointSize });
  const applyRef = useRef<() => void>(() => {});

  useEffect(() => {
    callbacks.current = {
      onPick: props.onPick,
      onHover: props.onHover,
      onDoublePick: props.onDoublePick,
      armed,
    };
  });

  const nodeBoxes = useCallback((): NodeBox[] => {
    const pco = engine.current?.pco;
    if (!pco) return [];
    return pco.visibleNodes.map((n) => {
      const b = n.boundingBox.clone().applyMatrix4(pco.matrixWorld);
      return {
        level: n.level,
        min: b.min.toArray() as NodeBox["min"],
        max: b.max.toArray() as NodeBox["max"],
      };
    });
  }, []);

  const rootSpacing = useCallback(
    (e: Engine): number =>
      cloud.octree_spacing_m ?? (e.pco?.pcoGeometry as unknown as { spacing?: number })?.spacing ?? 1,
    [cloud.octree_spacing_m],
  );

  const toCloudPick = useCallback(
    (e: Engine, p: THREE.Vector3): CloudPick => {
      const level = deepestLevelAt(nodeBoxes(), p) ?? 0;
      return { x: p.x, y: p.y, z: p.z, level, uncertainty_m: pickUncertainty(rootSpacing(e), level) };
    },
    [nodeBoxes, rootSpacing],
  );

  const pickAtClient = useCallback(
    (clientX: number, clientY: number): CloudPick | null => {
      const e = engine.current;
      const canvas = canvasRef.current;
      if (!e?.pco || !canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, e.camera);
      // potree's rule (the drawn point nearest the window centre), over the valid hits only: its own
      // pick answered null on the chimney with 18 points drawn in the window (see pickAllPoints)
      const all = pickAllPoints(e.pco, e.renderer, e.camera, ray.ray, PICK_WINDOW);
      const p = all
        ? nearestToCentre(all)
        : (e.pco.pick(e.renderer, e.camera, ray.ray, { pickWindowSize: PICK_WINDOW })?.position ?? null);
      return p ? toCloudPick(e, new THREE.Vector3(p.x, p.y, p.z)) : null;
    },
    [toCloudPick],
  );

  const pickDown = useCallback(
    (x: number, y: number, radius: number): CloudPick | null => {
      const e = engine.current;
      const canvas = canvasRef.current;
      if (!e?.pco || !canvas || !bounds) return null;
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
      const all = pickAllPoints(e.pco, e.renderer, down, ray, Math.min(w, h));
      const spacing = rootSpacing(e);
      const p = all
        ? topmostWithin(
            all.map((h) => ({ ...h, reach: pickUncertainty(spacing, h.level) })),
            x,
            y,
            radius,
          )
        : (e.pco.pick(e.renderer, down, ray, { pickWindowSize: Math.min(w, h) })?.position ?? null);
      if (!p || Math.hypot(p.x - x, p.y - y) > radius) return null;
      return toCloudPick(e, new THREE.Vector3(p.x, p.y, p.z));
    },
    [bounds, rootSpacing, toCloudPick],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = box.current;
    if (!canvas || !host) return;
    const key = `${cloud.id}|${octreeUrl}|${generation}`;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        powerPreference: "high-performance",
      });
    } catch {
      // No WebGL (a graphics driver that cannot start it): three throws here. Say so in the view
      // rather than letting the throw take the whole screen down to the router's error page.
      setNoWebGlKey(key);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const clear = tokenRgb("canvas");
    renderer.setClearColor(tokenColor(clear));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 1e6);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, canvas);
    controls.zoomToCursor = true;
    controls.screenSpacePanning = true;
    const potree = new Potree();
    potree.pointBudget = budget;
    const overlay = new THREE.Group();
    overlay.renderOrder = 10;
    scene.add(overlay);
    const stats = emptyStats();
    const started = performance.now();
    const diagonal = bounds ? siteDiagonal(bounds) : 1000;
    let raf = 0;
    let lastInputAt = started;
    let lastLoadAt = started;
    let lastBarAt = 0;
    let disposed = false;

    const e: Engine = {
      renderer,
      scene,
      camera,
      controls,
      potree,
      overlay,
      pco: null,
      stats,
      requestRender: () => {},
    };
    engine.current = e;

    const tick = () => {
      raf = 0;
      if (disposed) return;
      const now = performance.now();
      const distance = camera.position.distanceTo(controls.target);
      const nf = nearFar(distance, diagonal);
      camera.near = nf.near;
      camera.far = nf.far;
      camera.updateProjectionMatrix();
      stats.cameraDistance = distance;
      let pending = 0;
      if (e.pco) {
        const r = potree.updatePointClouds([e.pco], camera, renderer);
        // a failed node is reported through nodeLoadFailed below, not as an unhandled rejection;
        // allSettled, because potree-core 2.0.15 also puts undefined entries in this list
        void Promise.allSettled(r.nodeLoadPromises);
        const loading = (e.pco.pcoGeometry as unknown as { numNodesLoading?: number }).numNodesLoading ?? 0;
        pending = r.nodeLoadPromises.length + (r.exceededMaxLoadsToGPU ? 1 : 0);
        stats.numVisiblePoints = r.numVisiblePoints;
        stats.visibleNodes = r.visibleNodes.length;
        stats.nodesLoading = loading;
        if (loading > 0 || pending > 0) lastLoadAt = now;
        if (stats.firstPointsMs === null && r.visibleNodes.length > 0) stats.firstPointsMs = now - started;
        if (stats.firstPointsMs !== null && stats.settledMs === null && loading === 0 && pending === 0) {
          stats.settledMs = now - started;
        }
        if (r.nodeLoadFailed) pushErrorOnce(stats.errors, "a node failed to load");
        pending += loading;
      }
      renderer.render(scene, camera);
      if (now - lastBarAt > 250) {
        lastBarAt = now;
        setBar((b) => ({ ...b, pts: stats.numVisiblePoints, loading: stats.nodesLoading }));
      }
      const keep = shouldKeepRendering({
        nodesLoading: stats.nodesLoading,
        pendingLoads: pending,
        lastActivityAt: Math.max(lastInputAt, lastLoadAt),
        now,
        hidden: document.hidden,
      });
      if (keep) raf = requestAnimationFrame(tick);
    };
    const requestRender = () => {
      lastInputAt = performance.now();
      if (!raf && !disposed && !document.hidden) raf = requestAnimationFrame(tick);
    };
    e.requestRender = requestRender;

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
    controls.addEventListener("start", requestRender);

    let down: { x: number; y: number } | null = null;
    let lastHover = 0;
    const onDown = (ev: PointerEvent) => {
      down = { x: ev.clientX, y: ev.clientY };
      requestRender();
    };
    const onUp = (ev: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || ev.button !== 0 || Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > CLICK_SLOP_PX) return;
      const p = pickAtClient(ev.clientX, ev.clientY);
      if (p) {
        setBar((b) => ({ ...b, pick: p }));
        callbacks.current.onPick?.(p);
      }
    };
    const onMove = (ev: PointerEvent) => {
      if (!callbacks.current.armed || down) return;
      const now = performance.now();
      if (now - lastHover < HOVER_MS) return;
      lastHover = now;
      callbacks.current.onHover?.(pickAtClient(ev.clientX, ev.clientY));
    };
    const onDouble = (ev: MouseEvent) => {
      const p = pickAtClient(ev.clientX, ev.clientY);
      if (!p) return;
      controls.target.set(p.x, p.y, p.z);
      controls.update();
      callbacks.current.onDoublePick?.(p);
      requestRender();
    };
    const onLost = (ev: Event) => {
      ev.preventDefault();
      stats.contextLost = true;
      pushErrorOnce(stats.errors, "webglcontextlost");
      setLostKey(key);
    };
    const onVisible = () => {
      if (!document.hidden) requestRender();
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("dblclick", onDouble);
    canvas.addEventListener("webglcontextlost", onLost);
    document.addEventListener("visibilitychange", onVisible);

    potree
      .loadPointCloud(metadataUrl(octreeUrl), makeRequestManager(token))
      .then((pco) => {
        if (disposed) {
          disposePointsGeometries(pco);
          pco.dispose();
          return;
        }
        pco.material.gradient = VIRIDIS;
        scene.add(pco);
        e.pco = pco;
        const view = bounds ? wholeSiteView(bounds) : null;
        if (view) {
          camera.position.set(view.position.x, view.position.y, view.position.z);
          controls.target.set(view.target.x, view.target.y, view.target.z);
          controls.update();
        }
        applyMaterial();
        requestRender();
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        pushErrorOnce(stats.errors, `load: ${message}`);
        if (!disposed) setLoadError({ key, message });
      });

    function applyMaterial() {
      const pco = e.pco;
      if (!pco) return;
      const o = makeMaterialOptions(materialRef.current);
      // materialOptions.ts spells potree-core's enum values out as numbers (so its test never loads WebGL code)
      type M = PointCloudMaterial; // ColorEncoding itself is not exported from potree-core's index
      pco.material.inputColorEncoding = o.inputColorEncoding as M["inputColorEncoding"];
      pco.material.outputColorEncoding = o.outputColorEncoding as M["outputColorEncoding"];
      pco.material.pointSizeType = o.pointSizeType as M["pointSizeType"];
      pco.material.pointColorType = o.pointColorType as M["pointColorType"];
      pco.material.size = o.size;
      pco.material.elevationRange = o.elevationRange;
    }
    applyRef.current = applyMaterial;

    let releaseHook = () => {};
    if (diagnosticsEnabled()) {
      releaseHook = installHook({
        stats: () => ({ ...stats, errors: [...stats.errors] }),
        sampleColours: (): ColourSample => {
          renderer.render(scene, camera);
          const gl = renderer.getContext();
          const w = gl.drawingBufferWidth;
          const h = gl.drawingBufferHeight;
          const buf = new Uint8Array(w * h * 4);
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
          return classifyPixels(buf, clear);
        },
        pickCenter: () => {
          const r = canvas.getBoundingClientRect();
          return pickAtClient(r.left + r.width / 2, r.top + r.height / 2);
        },
        pickDown: (x: number, y: number, radius: number) => pickDown(x, y, radius),
        overlays: () => [...new Set(overlay.children.map((c) => String(c.userData.key)))],
      });
    }

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("dblclick", onDouble);
      canvas.removeEventListener("webglcontextlost", onLost);
      document.removeEventListener("visibilitychange", onVisible);
      controls.dispose();
      // the canvas is keyed by `generation` only: a new cloud reuses this WebGL context, so every
      // buffer this scene made is released here, not left to the context's end
      disposeChildren(overlay);
      if (e.pco) {
        disposePointsGeometries(e.pco);
        e.pco.dispose();
      }
      renderer.dispose();
      releaseHook();
      engine.current = null;
      applyRef.current = () => {};
    };
    // budget/material changes are applied by the effects below without rebuilding the scene
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud.id, octreeUrl, token, generation]);

  useEffect(() => {
    materialRef.current = { colour, elevationRange, pointSize };
    applyRef.current();
    engine.current?.requestRender();
  }, [colour, elevationRange, pointSize]);
  useEffect(() => {
    if (engine.current) engine.current.potree.pointBudget = budget;
    engine.current?.requestRender();
  }, [budget]);

  useImperativeHandle(
    ref,
    (): CloudViewerHandle => ({
      fit() {
        const e = engine.current;
        if (!e || !bounds) return;
        const v = wholeSiteView(bounds);
        e.camera.position.set(v.position.x, v.position.y, v.position.z);
        e.controls.target.set(v.target.x, v.target.y, v.target.z);
        e.controls.update();
        e.requestRender();
      },
      topView() {
        const e = engine.current;
        if (!e || !bounds) return;
        const v = topView(bounds);
        e.camera.position.set(v.position.x, v.position.y, v.position.z);
        e.controls.target.set(v.target.x, v.target.y, v.target.z);
        e.controls.update();
        e.requestRender();
      },
      lookAt(target, distance) {
        const e = engine.current;
        if (!e) return;
        const k = Math.SQRT1_2 * distance;
        e.camera.position.set(target.x, target.y - k, target.z + k);
        e.controls.target.set(target.x, target.y, target.z);
        e.controls.update();
        e.requestRender();
      },
      pickAtClient,
      pickDown,
      canvasRect() {
        const r = canvasRef.current?.getBoundingClientRect();
        return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
      },
      project(p) {
        const e = engine.current;
        const canvas = canvasRef.current;
        if (!e || !canvas) return null;
        const v = new THREE.Vector3(p.x, p.y, p.z).project(e.camera);
        if (v.z > 1 || v.z < -1) return null;
        const r = canvas.getBoundingClientRect();
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
      },
      setOverlay(key, shapes) {
        const e = engine.current;
        if (!e || !bounds) return;
        const origin = { x: bounds[0], y: bounds[1], z: bounds[2] };
        e.overlay.position.set(origin.x, origin.y, origin.z);
        disposeChildren(e.overlay, (c) => c.userData.key === key);
        for (const s of shapes) {
          const color = tokenColor(
            tokenRgb(s.tone === "accent" ? "accent" : s.tone === "ok" ? "ok" : "warn"),
          );
          const geom = new THREE.BufferGeometry();
          const closed = s.kind === "line" && !!s.closed;
          geom.setAttribute(
            "position",
            new THREE.BufferAttribute(localPositions(s.points, origin, closed), 3),
          );
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
          e.overlay.add(obj);
        }
        e.requestRender();
      },
      stats: () => ({ ...(engine.current?.stats ?? emptyStats()) }),
    }),
    [bounds, pickAtClient, pickDown],
  );

  return (
    <div ref={box} className="relative min-h-0 min-w-0 flex-1" data-testid="cloud-viewer">
      <canvas
        key={generation}
        ref={canvasRef}
        data-testid="cloud-canvas"
        className="absolute inset-0 h-full w-full bg-canvas"
        style={{ cursor: armed ? "crosshair" : "grab" }}
      />
      {noWebGlKey === sceneKey && (
        <div className="absolute inset-x-4 top-4">
          <Alert tone="danger" title="The 3D view could not start">
            This computer&apos;s graphics could not start WebGL, which the 3D view draws with. Updating the
            graphics driver usually fixes this; the cloud&apos;s details and export still work.
          </Alert>
        </div>
      )}
      {loadError?.key === sceneKey && (
        <div className="absolute inset-x-4 top-4">
          <Alert tone="danger" title="The 3D view could not be shown">
            {loadError.message}
          </Alert>
        </div>
      )}
      {lostKey === sceneKey && (
        <div className="absolute inset-x-4 top-4">
          <Alert
            tone="warn"
            actions={
              <Button size="sm" icon="refresh" onClick={() => setGeneration((g) => g + 1)}>
                Reload view
              </Button>
            }
          >
            The 3D view lost its graphics context
          </Alert>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-4 border-t border-line bg-panel/90 px-3 py-1.5 text-xs tabular-nums text-muted">
        <span data-testid="cloud-points-shown">{points.format(bar.pts / 1e6)} M points shown</span>
        {bar.loading > 0 && <span>loading {bar.loading} nodes</span>}
        {bar.pick && (
          <span className="ml-auto text-ink">
            E {fmt(bar.pick.x)} · N {fmt(bar.pick.y)} · Z {fmt(bar.pick.z)}
          </span>
        )}
      </div>
    </div>
  );
});
