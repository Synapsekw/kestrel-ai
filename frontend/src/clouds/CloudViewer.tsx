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
import { resolveNavMode, type AppliedNavMode } from "./viewer/navMode";
import type { OverlayShape } from "./viewer/overlay";
import type {
  CameraPose,
  CameraPoseInput,
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
  setEdl(on: boolean): void;
  /** Draws one frame now (e.g. after the panels around the canvas changed its layout). */
  requestRender(): void;
}

/** What the 3D view is doing, for the workspace (plan Ruling 16). */
export type ViewState = "running" | "no-webgl" | "lost" | "load-error";

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
  /** The view started, could not start (no WebGL), failed to load, or lost its context. */
  onViewState?(state: ViewState): void;
  /** Points shown and nodes loading, at the engine's ≤ 4 Hz bar cadence (the old status bar's numbers). */
  onPointsShown?(s: { pts: number; loading: number }): void;
}

/** The React shell around `viewer/engine.ts` (spec §5 Viewer row): alerts, status bar, handle, hook. */
export const CloudViewer = forwardRef<CloudViewerHandle, CloudViewerProps>(function CloudViewer(props, ref) {
  const { cloud, octreeUrl, token, budget, colour, elevationRange, pointSize, armed = false } = props;
  const box = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = useRef<CloudEngine | null>(null);
  const [bridge] = useState(() => new FrameBridge()); // lazy: one bridge for the shell's life
  const callbacks = useRef({
    onPick: props.onPick,
    onHover: props.onHover,
    onDoublePick: props.onDoublePick,
    onAttributes: props.onAttributes,
    onViewState: props.onViewState,
    onPointsShown: props.onPointsShown,
    armed,
  });
  const [generation, setGeneration] = useState(0);
  // Keyed by the scene they belong to, so a new cloud or a "Reload view" clears them without a
  // synchronous setState in the effect (react-hooks `set-state-in-effect`).
  const sceneKey = `${cloud.id}|${octreeUrl}|${generation}`;
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);
  const [lostKey, setLostKey] = useState<string | null>(null);
  const [noWebGlKey, setNoWebGlKey] = useState<string | null>(null);
  const bounds = cloud.bounds_native as Bounds6 | null;
  // Read when the engine is built, so a colour/size/budget change never rebuilds the scene.
  const materialRef = useRef({ colour, elevationRange, pointSize });
  const budgetRef = useRef(budget);
  // The colour prop last applied, so the material effect below never reverts a handle colour (Ruling 12).
  const colourProp = useRef(colour);
  // Handle state that outlives an engine ("Reload view", a new cloud), re-applied to each new one.
  const navRef = useRef<AppliedNavMode>("orbit");
  const hiddenRef = useRef<ReadonlySet<number>>(new Set());

  useEffect(() => {
    callbacks.current = {
      onPick: props.onPick,
      onHover: props.onHover,
      onDoublePick: props.onDoublePick,
      onAttributes: props.onAttributes,
      onViewState: props.onViewState,
      onPointsShown: props.onPointsShown,
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
          onPick: (p) => callbacks.current.onPick?.(p),
          onHover: (p) => callbacks.current.onHover?.(p),
          onDoublePick: (p) => callbacks.current.onDoublePick?.(p),
          onBar: (s) => callbacks.current.onPointsShown?.({ pts: s.pts, loading: s.loading }),
          onLoaded: (a) => callbacks.current.onAttributes?.(a),
          onLoadError: (message) => {
            setLoadError({ key, message });
            callbacks.current.onViewState?.("load-error");
          },
          onContextLost: () => {
            setLostKey(key);
            callbacks.current.onViewState?.("lost");
          },
        },
      });
    } catch (err) {
      // No WebGL (a graphics driver that cannot start it): say so in the view rather than letting
      // the throw take the whole screen down to the router's error page.
      if (err instanceof NoWebGlError) {
        setNoWebGlKey(key);
        callbacks.current.onViewState?.("no-webgl");
        return;
      }
      throw err;
    }
    engine.current = e;
    callbacks.current.onViewState?.("running");
    if (navRef.current !== "orbit") e.setNavMode(navRef.current);
    if (hiddenRef.current.size > 0) e.setClassVisibility(hiddenRef.current);
    bridge.attach(e);
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
      bridge.detach();
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
        navRef.current = resolveNavMode(mode, navRef.current); // "fly" keeps the mode (Ruling 2)
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
      setEdl: (on) => engine.current?.setEdl(on),
      requestRender: () => engine.current?.requestRender(),
    }),
    [bridge],
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
    </div>
  );
});
