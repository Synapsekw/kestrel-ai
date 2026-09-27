// frontend/src/clouds/CloudViewer.tsx
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { PointCloud } from "@/api/clouds";
import { Alert, Button } from "@/ui";
import type { Bounds6, Vec3 as XYZ } from "./viewer/camera";
import {
  diagnosticsEnabled,
  installHook,
  type FrameCameraSample,
  type ViewerStats,
} from "./viewer/diagnostics";
import { reducedEffects, watchEffects } from "./viewer/edl";
import { createEngine, emptyStats, NoWebGlError, type CloudEngine, type CloudPick } from "./viewer/engine";
import { FrameBridge } from "./viewer/frameBridge";
import type { ColourMode } from "./viewer/materialOptions";
import type { OverlayShape } from "./viewer/overlay";
import type {
  CameraPose,
  ColourAvailability,
  EdlState,
  FrameCallback,
  NavMode,
  ViewName,
} from "./viewer/types";

export type { CloudPick } from "./viewer/engine";

export interface CloudViewerHandle {
  fit(): void;
  topView(): void;
  lookAt(target: XYZ, distance: number): void;
  pickAtClient(clientX: number, clientY: number): CloudPick | null;
  /**
   * The top surface within `radius` m (horizontally) of (x, y), at its loaded point nearest the spot
   * (`topmostWithin`): potree's picker run with an orthographic camera above the cloud looking
   * straight down, so the answer does not depend on the current view (no viewport clamping, no
   * horizontal error), then every point it drew read back and compared.
   */
  pickDown(x: number, y: number, radius: number): CloudPick | null;
  /** Client (viewport) coordinates of a native-CRS point, or null behind the camera; may be off the canvas. */
  project(p: XYZ): { x: number; y: number } | null;
  /** The canvas in client coordinates, or null before it exists. */
  canvasRect(): { left: number; top: number; right: number; bottom: number } | null;
  setOverlay(key: string, shapes: OverlayShape[]): void;
  stats(): ViewerStats;
  /** Spec §7 (C-V1). "fly" is ignored until C-V2. */
  setNavMode(mode: NavMode): void;
  navMode(): NavMode;
  /** A 350 ms tween; instant under reduced motion. */
  setView(view: ViewName): void;
  goToPose(pose: CameraPose): void;
  currentPose(): CameraPose | null;
  setColourMode(mode: ColourMode): void;
  setClassVisibility(hidden: ReadonlySet<number>): void;
  colourAvailability(): ColourAvailability | null;
  /** Called after each render, never while idle; survives a cloud switch. Returns the unsubscribe. */
  onFrame(cb: FrameCallback): () => void;
  topSnapshot(px?: number): Promise<ImageBitmap | null>;
  frameTimes(): number[];
  edl(): EdlState | null;
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
  /** The octree loaded: which colour modes this cloud can show (spec §7 Colour). */
  onAttributes?(a: ColourAvailability): void;
}

const fmt = (v: number) => v.toFixed(3);
const points = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });

/** The React shell around `viewer/engine.ts` (spec §5 Viewer row): alerts, status bar, handle, hook. */
export const CloudViewer = forwardRef<CloudViewerHandle, CloudViewerProps>(function CloudViewer(props, ref) {
  const { cloud, octreeUrl, token, budget, colour, elevationRange, pointSize, armed = false } = props;
  const box = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = useRef<CloudEngine | null>(null);
  const bridge = useRef(new FrameBridge());
  const callbacks = useRef({
    onPick: props.onPick,
    onHover: props.onHover,
    onDoublePick: props.onDoublePick,
    onAttributes: props.onAttributes,
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
  // Read when the engine is built, so a colour/size/budget change never rebuilds the scene.
  const materialRef = useRef({ colour, elevationRange, pointSize });
  const budgetRef = useRef(budget);

  useEffect(() => {
    callbacks.current = {
      onPick: props.onPick,
      onHover: props.onHover,
      onDoublePick: props.onDoublePick,
      onAttributes: props.onAttributes,
      armed,
    };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = box.current;
    if (!canvas || !host) return;
    const key = `${cloud.id}|${octreeUrl}|${generation}`;
    let e: CloudEngine;
    try {
      e = createEngine({
        canvas,
        host,
        bounds,
        octreeSpacingM: cloud.octree_spacing_m ?? null,
        octreeUrl,
        token,
        budget: budgetRef.current,
        material: materialRef.current,
        edl: !reducedEffects(),
        events: {
          isArmed: () => callbacks.current.armed,
          onPick: (p) => {
            setBar((b) => ({ ...b, pick: p }));
            callbacks.current.onPick?.(p);
          },
          onHover: (p) => callbacks.current.onHover?.(p),
          onDoublePick: (p) => callbacks.current.onDoublePick?.(p),
          onBar: (s) => setBar((b) => ({ ...b, pts: s.pts, loading: s.loading })),
          onLoaded: (a) => callbacks.current.onAttributes?.(a),
          onLoadError: (message) => setLoadError({ key, message }),
          onContextLost: () => setLostKey(key),
        },
      });
    } catch (err) {
      // No WebGL (a graphics driver that cannot start it): say so in the view rather than letting
      // the throw take the whole screen down to the router's error page.
      if (err instanceof NoWebGlError) {
        setNoWebGlKey(key);
        return;
      }
      throw err;
    }
    engine.current = e;
    const frames = bridge.current;
    frames.attach(e);
    const stopEffects = watchEffects((reduced) => e.setEdl(!reduced));

    let releaseHook = () => {};
    if (diagnosticsEnabled()) {
      let last: FrameCameraSample | null = null;
      const stopRecording = e.onFrame((cam) => {
        last = {
          viewProj: Array.from(cam.viewProj),
          rect: { left: cam.rect.left, top: cam.rect.top, width: cam.rect.width, height: cam.rect.height },
          position: cam.position,
          direction: cam.direction,
        };
      });
      const release = installHook({
        stats: () => e.stats(),
        sampleColours: () => e.sampleColours(),
        pickCenter: () => {
          const r = canvas.getBoundingClientRect();
          return e.pickAtClient(r.left + r.width / 2, r.top + r.height / 2);
        },
        pickDown: (x, y, radius) => e.pickDown(x, y, radius),
        overlays: () => e.overlayKeys(),
        frameTimes: () => e.frameTimes(),
        setNavMode: (m) => e.setNavMode(m),
        navMode: () => e.navMode(),
        setView: (v) => e.setView(v),
        scriptOrbit: (s) => e.scriptOrbit(s),
        cameraPose: () => e.currentPose(),
        lastFrame: () => last,
        edl: () => e.edl(),
        setEdl: (on) => e.setEdl(on),
        topSnapshotSample: (px) => Promise.resolve(e.topSnapshotSample(px)),
      });
      releaseHook = () => {
        stopRecording();
        release();
      };
    }

    return () => {
      releaseHook();
      stopEffects();
      frames.detach();
      e.dispose();
      engine.current = null;
    };
    // budget/material changes are applied by the effects below without rebuilding the scene
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud.id, octreeUrl, token, generation]);

  useEffect(() => {
    materialRef.current = { colour, elevationRange, pointSize };
    engine.current?.setMaterial(materialRef.current);
  }, [colour, elevationRange, pointSize]);
  useEffect(() => {
    budgetRef.current = budget;
    engine.current?.setBudget(budget);
  }, [budget]);

  useImperativeHandle(
    ref,
    (): CloudViewerHandle => ({
      fit: () => engine.current?.fit(),
      topView: () => engine.current?.topView(),
      lookAt: (target, distance) => engine.current?.lookAt(target, distance),
      pickAtClient: (x, y) => engine.current?.pickAtClient(x, y) ?? null,
      pickDown: (x, y, radius) => engine.current?.pickDown(x, y, radius) ?? null,
      project: (p) => engine.current?.project(p) ?? null,
      canvasRect() {
        const r = canvasRef.current?.getBoundingClientRect();
        return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
      },
      setOverlay: (key, shapes) => engine.current?.setOverlay(key, shapes),
      stats: () => engine.current?.stats() ?? emptyStats(),
      setNavMode: (mode) => engine.current?.setNavMode(mode),
      navMode: () => engine.current?.navMode() ?? "orbit",
      setView: (view) => engine.current?.setView(view),
      goToPose: (pose) => engine.current?.goToPose(pose),
      currentPose: () => engine.current?.currentPose() ?? null,
      setColourMode(mode) {
        materialRef.current = { ...materialRef.current, colour: mode }; // plan Ruling 12
        engine.current?.setColourMode(mode);
      },
      setClassVisibility: (hidden) => engine.current?.setClassVisibility(hidden),
      colourAvailability: () => engine.current?.colourAvailability() ?? null,
      onFrame: (cb) => bridge.current.add(cb),
      topSnapshot: (px) => engine.current?.topSnapshot(px) ?? Promise.resolve(null),
      frameTimes: () => engine.current?.frameTimes() ?? [],
      edl: () => engine.current?.edl() ?? null,
    }),
    [],
  );

  return (
    <div ref={box} className="relative min-h-0 min-w-0 flex-1" data-testid="cloud-viewer">
      <canvas
        key={generation}
        ref={canvasRef}
        data-testid="cloud-canvas"
        className="absolute inset-0 h-full w-full bg-bg"
        style={{ cursor: armed ? "crosshair" : "grab" }}
      />
      {/* The notices sit on the opaque glass-solid backing: the tones alone are 15% tints, unreadable over the points. */}
      {noWebGlKey === sceneKey && (
        <div className="absolute inset-x-4 top-4 rounded-control bg-glass-solid shadow-elev-2">
          <Alert tone="danger" title="The 3D view could not start">
            This computer&apos;s graphics could not start WebGL, which the 3D view draws with. Updating the
            graphics driver usually fixes this; the cloud&apos;s details and export still work.
          </Alert>
        </div>
      )}
      {loadError?.key === sceneKey && (
        <div className="absolute inset-x-4 top-4 rounded-control bg-glass-solid shadow-elev-2">
          <Alert tone="danger" title="The 3D view could not be shown">
            {loadError.message}
          </Alert>
        </div>
      )}
      {lostKey === sceneKey && (
        <div className="absolute inset-x-4 top-4 rounded-control bg-glass-solid shadow-elev-2">
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
      {/* S1's status bar: C-W1 deletes it (the readout pill replaces it). */}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-4 border-t border-line bg-glass px-3 py-1.5 text-xs tabular-nums text-muted">
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
