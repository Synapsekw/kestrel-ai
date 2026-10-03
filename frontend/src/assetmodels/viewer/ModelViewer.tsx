import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { NoWebGlError } from "@/clouds/viewer/engine";
import { Alert, Button, Skeleton } from "@/ui";
import type { CameraPose } from "./cameras";
import { createModelEngine, type ModelEngine, type ModelPart, type ModelView, type PickHit } from "./engine";
import type { FocusSettings } from "./focus";
import type { GroundTile } from "./ground";
import type { FetchPatch, PlacementItem } from "./placements";

export type ModelViewState = "loading" | "running" | "no-webgl" | "load-error";
export type ModelViewerHandle = Omit<ModelEngine, "load" | "dispose" | "onPick">;

export interface ModelViewerProps {
  glbUrl: string | null;
  onParts(parts: ModelPart[]): void;
  onSelect(id: string | null): void;
  /** The view is loading, showing the model, could not start (no WebGL), or could not load the GLB. */
  onState?(s: ModelViewState): void;
  /** Where the notices go (px from the viewer's edges), so the workspace's panels never cover them. */
  noticeInset?: { left: number; right: number; top: number };
  /** A click on a finding, a camera or a part (the part also arrives through `onSelect`). */
  onPick?(hit: PickHit): void;
}

/** What the workspace last asked for; replayed onto each new engine (a reload, a new GLB). */
interface Wanted {
  hidden: Set<string>;
  cut: number | null;
  levels: boolean;
  headOff: boolean;
  overlay: Float32Array | null;
  selected: string | null;
  placements: { items: PlacementItem[]; fetchPatch: FetchPatch } | null;
  cameras: { poses: CameraPose[]; colourOf: (p: CameraPose) => string } | null;
  selectedCamera: { id: string | null; cone: boolean };
  ghost: boolean;
  autoRotate: { on: boolean; speed?: number };
  ground: GroundTile[] | null;
  pose: CameraPose | null;
}

/** The React shell around `engine.ts`: the canvas, the notices, and the handle the workspace drives. */
export const ModelViewer = forwardRef<ModelViewerHandle, ModelViewerProps>(function ModelViewer(props, ref) {
  const { glbUrl, noticeInset } = props;
  const box = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = useRef<ModelEngine | null>(null);
  const cbs = useRef(props);
  const wanted = useRef<Wanted>({
    hidden: new Set(),
    cut: null,
    levels: false,
    headOff: false,
    overlay: null,
    selected: null,
    placements: null,
    cameras: null,
    selectedCamera: { id: null, cone: false },
    ghost: false,
    autoRotate: { on: false },
    ground: null,
    pose: null,
  });
  const [generation, setGeneration] = useState(0);
  const sceneKey = `${glbUrl ?? ""}#${generation}`;
  const [status, setStatus] = useState<{ key: string; state: ModelViewState }>({ key: "", state: "loading" });
  const state: ModelViewState = status.key === sceneKey ? status.state : "loading";

  useEffect(() => {
    cbs.current = props;
  });
  useEffect(() => {
    cbs.current.onState?.(state);
  }, [state]);

  // One engine per canvas (a "Reload view" makes a new canvas and engine). A new GLB of the same model
  // loads into it and keeps the camera (spec §8); only the engine's first load frames the iso view.
  const framed = useRef(false);
  /** Set while the shell drives `select` itself, so the engine's echo never reaches the workspace. */
  const quiet = useRef(false);
  const selectQuietly = (eng: ModelEngine, id: string | null) => {
    quiet.current = true;
    try {
      eng.select(id);
    } finally {
      quiet.current = false;
    }
  };
  useEffect(
    () => () => {
      engine.current?.dispose();
      engine.current = null;
    },
    [generation],
  );
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = box.current;
    if (!glbUrl || !canvas || !host) return;
    let eng = engine.current;
    if (!eng) {
      try {
        eng = createModelEngine({
          canvas,
          host,
          onSelect: (id) => {
            if (quiet.current) return;
            wanted.current.selected = id;
            cbs.current.onSelect(id);
          },
        });
      } catch (err) {
        if (err instanceof NoWebGlError) setStatus({ key: sceneKey, state: "no-webgl" });
        else setStatus({ key: sceneKey, state: "load-error" });
        return;
      }
      engine.current = eng;
      eng.onPick((hit) => cbs.current.onPick?.(hit));
      framed.current = false;
    }
    const live = eng;
    let cancelled = false;
    live.load(glbUrl, { keepCamera: framed.current }).then(
      (parts) => {
        if (cancelled) return;
        framed.current = true;
        const w = wanted.current;
        for (const g of w.hidden) live.setGroupVisible(g, false);
        live.setCut(w.cut);
        live.setLevels(w.levels);
        live.setHeadOff(w.headOff);
        live.setOverlay(w.overlay);
        if (w.placements) live.setPlacements(w.placements.items, w.placements.fetchPatch);
        if (w.cameras) live.setCameras(w.cameras.poses, w.cameras.colourOf);
        live.setSelectedCamera(w.selectedCamera.id, w.selectedCamera.cone);
        live.setGhost(w.ghost);
        live.setAutoRotate(w.autoRotate.on, w.autoRotate.speed);
        live.setGround(w.ground);
        if (w.pose) live.viewFromPose(w.pose);
        if (w.selected) selectQuietly(live, w.selected);
        setStatus({ key: sceneKey, state: "running" });
        cbs.current.onParts(parts);
      },
      () => {
        if (!cancelled) setStatus({ key: sceneKey, state: "load-error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [glbUrl, generation, sceneKey]);

  useImperativeHandle(
    ref,
    (): ModelViewerHandle => ({
      setGroupVisible(group, visible) {
        if (visible) wanted.current.hidden.delete(group);
        else wanted.current.hidden.add(group);
        engine.current?.setGroupVisible(group, visible);
      },
      select(id) {
        wanted.current.selected = id;
        if (engine.current) selectQuietly(engine.current, id);
      },
      setCut(bearing) {
        wanted.current.cut = bearing;
        engine.current?.setCut(bearing);
      },
      setLevels(on) {
        wanted.current.levels = on;
        engine.current?.setLevels(on);
      },
      setHeadOff(on) {
        wanted.current.headOff = on;
        engine.current?.setHeadOff(on);
      },
      setOverlay(points) {
        wanted.current.overlay = points;
        engine.current?.setOverlay(points);
      },
      setView(view: ModelView) {
        // a preset view leaves the pose view, so a fresh engine must not replay it
        wanted.current.pose = null;
        engine.current?.setView(view);
      },
      setPlacements(items, fetchPatch) {
        wanted.current.placements = { items, fetchPatch };
        engine.current?.setPlacements(items, fetchPatch);
      },
      setCameras(poses, colourOf) {
        wanted.current.cameras = { poses, colourOf };
        engine.current?.setCameras(poses, colourOf);
      },
      setSelectedCamera(id, cone) {
        wanted.current.selectedCamera = { id, cone };
        engine.current?.setSelectedCamera(id, cone);
      },
      focusFinding(id: string, settings?: FocusSettings) {
        wanted.current.pose = null;
        return engine.current?.focusFinding(id, settings) ?? false;
      },
      setGhost(on) {
        wanted.current.ghost = on;
        engine.current?.setGhost(on);
      },
      setAutoRotate(on, speed) {
        wanted.current.autoRotate = { on, speed };
        engine.current?.setAutoRotate(on, speed);
      },
      setGround(tiles) {
        wanted.current.ground = tiles;
        engine.current?.setGround(tiles);
      },
      viewFromPose(pose) {
        wanted.current.pose = pose;
        engine.current?.viewFromPose(pose);
      },
    }),
    [],
  );

  const notice = useMemo(() => {
    if (state === "no-webgl")
      return (
        <Alert tone="warn" role="alert">
          This computer can&apos;t start WebGL, so the 3D view is off. The parts list still works.
        </Alert>
      );
    if (state === "load-error")
      return (
        <Alert
          tone="danger"
          actions={
            <Button size="sm" icon="refresh" onClick={() => setGeneration((g) => g + 1)}>
              Reload view
            </Button>
          }
        >
          The 3D model could not load.
        </Alert>
      );
    return null;
  }, [state]);

  return (
    <div ref={box} className="relative min-h-0 min-w-0 flex-1" data-testid="model-viewer">
      <canvas
        key={generation}
        ref={canvasRef}
        data-testid="model-canvas"
        className="absolute inset-0 h-full w-full bg-bg"
        style={{ cursor: "grab" }}
      />
      {/* A new version swapping in keeps the old model in view until it is ready: no skeleton over it. */}
      {state === "loading" && status.state !== "running" && (
        <div
          role="status"
          aria-label="Loading 3D model"
          className="pointer-events-none absolute inset-0 z-[15] flex items-center justify-center"
        >
          <Skeleton className="h-40 w-40 rounded-card" />
        </div>
      )}
      {notice && (
        <div
          data-testid="model-viewer-notice"
          className="absolute left-4 right-4 top-4 z-[15] rounded-control bg-glass-solid shadow-elev-2"
          style={noticeInset}
        >
          {notice}
        </div>
      )}
    </div>
  );
});
