// frontend/src/clouds/CloudViewer.tsx
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { PointCloud } from "@/api/clouds";
import { Alert, Button } from "@/ui";
import type { Bounds6, Vec3 as XYZ } from "./viewer/camera";
import type { ClipBox, ClipBoxMode, ClipState } from "./viewer/clipBox";
import {
  diagnosticsEnabled,
  installHook,
  type FrameCameraSample,
  type ViewerStats,
} from "./viewer/diagnostics";
import { reducedEffects, watchEffects } from "./viewer/edl";
import { createEngine, emptyStats, NoWebGlError, type CloudEngine, type CloudPick } from "./viewer/engine";
import { FrameBridge } from "./viewer/frameBridge";
import type { LookPose, LookThrough } from "./viewer/lookThrough";
import type { ColourMode } from "./viewer/materialOptions";
import { resolveNavMode } from "./viewer/navMode";
import type { OverlayShape } from "./viewer/overlay";
import type { SlabSample } from "./viewer/slab";
import type {
  CameraPose,
  CameraPoseInput,
  ColourAvailability,
  EdlState,
  FrameCallback,
  NavMode,
  Vec3,
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
  /** Spec §7: orbit, pan, and fly (C-V2). */
  setNavMode(mode: NavMode): void;
  navMode(): NavMode;
  /** A 350 ms tween; instant under reduced motion. */
  setView(view: ViewName): void;
  /** Takes a `CameraPose` or C-C0's stored `CloudViewPose` as is; an invalid pose is ignored. */
  goToPose(pose: CameraPoseInput): void;
  currentPose(): CameraPose | null;
  setColourMode(mode: ColourMode): void;
  setClassVisibility(hidden: ReadonlySet<number>): void;
  colourAvailability(): ColourAvailability | null;
  /** Called after each render, never while idle; survives a cloud switch. Returns the unsubscribe. */
  onFrame(cb: FrameCallback): () => void;
  topSnapshot(px?: number): Promise<ImageBitmap | null>;
  frameTimes(): number[];
  edl(): EdlState | null;
  /** C-V2 (spec §7): see `CloudEngine`. The clip box survives an engine rebuild, like the nav mode. */
  setClipBox(box: ClipBox | null, mode?: ClipBoxMode): void;
  clipBox(): ClipState | null;
  /** Null without a running engine. */
  lookThrough(pose: LookPose): LookThrough | null;
  sampleSlab(a: Vec3, b: Vec3, thicknessM: number, maxPoints?: number): Promise<SlabSample>;
  /** Fires once each time the view settles; survives a cloud switch. Returns the unsubscribe. */
  onSettle(cb: () => void): () => void;
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
  const [bridge] = useState(() => new FrameBridge()); // lazy: one bridge for the shell's life
  const [settle] = useState(() => new Set<() => void>()); // the handle's settle listeners, across engines
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
  // The colour prop last applied, so the material effect below never reverts a handle colour (Ruling 12).
  const colourProp = useRef(colour);
  // Handle state that outlives an engine ("Reload view", a new cloud), re-applied to each new one.
  const navRef = useRef<NavMode>("orbit");
  const hiddenRef = useRef<ReadonlySet<number>>(new Set());
  const clipRef = useRef<ClipState | null>(null);

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
    if (navRef.current !== "orbit") e.setNavMode(navRef.current);
    if (hiddenRef.current.size > 0) e.setClassVisibility(hiddenRef.current);
    if (clipRef.current) e.setClipBox(clipRef.current.box, clipRef.current.mode);
    bridge.attach(e);
    const stopEffects = watchEffects((reduced) => e.setEdl(!reduced));
    const stopSettle = e.onSettle(() => {
      for (const cb of [...settle]) cb();
    });

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
        setClipBox: (box, mode) => e.setClipBox(box, mode),
        lookThrough: (pose) => {
          const lt = e.lookThrough(pose);
          return { centre: lt.toCanvas(pose.width / 2, pose.height / 2), frame: lt.frame() };
        },
        sampleSlab: async (a, b, thicknessM) => {
          const r = await e.sampleSlab(a, b, thicknessM);
          // bounded for page.evaluate: the spec computes its checks from the first 5000
          const n = Math.min(r.count, 5000);
          return {
            count: r.count,
            total: r.total,
            s: Array.from(r.s.subarray(0, n)),
            z: Array.from(r.z.subarray(0, n)),
          };
        },
        goToPose: (pose) => e.goToPose(pose),
      });
      releaseHook = () => {
        stopRecording();
        release();
      };
    }

    return () => {
      releaseHook();
      stopEffects();
      stopSettle();
      bridge.detach();
      navRef.current = e.navMode(); // the engine may have left fly itself (lookThrough)
      e.dispose();
      engine.current = null;
    };
    // budget/material changes are applied by the effects below without rebuilding the scene
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud.id, octreeUrl, token, generation]);

  // The colour prop and the handle's setColourMode write the same state; the last write wins (Ruling 12).
  useEffect(() => {
    if (colourProp.current === colour) return;
    colourProp.current = colour;
    materialRef.current = { ...materialRef.current, colour };
    engine.current?.setColourMode(colour);
  }, [colour]);
  useEffect(() => {
    materialRef.current = { ...materialRef.current, elevationRange, pointSize };
    engine.current?.setMaterial(materialRef.current);
  }, [elevationRange, pointSize]);
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
      setNavMode(mode) {
        navRef.current = resolveNavMode(mode);
        engine.current?.setNavMode(mode);
      },
      navMode: () => engine.current?.navMode() ?? navRef.current,
      setView: (view) => engine.current?.setView(view),
      goToPose: (pose) => engine.current?.goToPose(pose),
      currentPose: () => engine.current?.currentPose() ?? null,
      setColourMode(mode) {
        materialRef.current = { ...materialRef.current, colour: mode }; // plan Ruling 12
        engine.current?.setColourMode(mode);
      },
      setClassVisibility(hidden) {
        hiddenRef.current = new Set(hidden);
        engine.current?.setClassVisibility(hiddenRef.current);
      },
      colourAvailability: () => engine.current?.colourAvailability() ?? null,
      onFrame: (cb) => bridge.add(cb),
      topSnapshot: (px) => engine.current?.topSnapshot(px) ?? Promise.resolve(null),
      frameTimes: () => engine.current?.frameTimes() ?? [],
      edl: () => engine.current?.edl() ?? null,
      setClipBox(box, mode = "show_inside") {
        clipRef.current = box ? { box, mode } : null;
        engine.current?.setClipBox(box, mode);
      },
      clipBox: () => engine.current?.clipBox() ?? clipRef.current,
      lookThrough: (pose) => engine.current?.lookThrough(pose) ?? null,
      sampleSlab: (a, b, thicknessM, maxPoints) =>
        engine.current
          ? engine.current.sampleSlab(a, b, thicknessM, maxPoints)
          : Promise.reject(new Error("the 3D view is not running")),
      onSettle(cb) {
        settle.add(cb);
        return () => {
          settle.delete(cb);
        };
      },
    }),
    [bridge, settle],
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
