import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { NoWebGlError } from "@/clouds/viewer/engine";
import { Alert, Button, Skeleton } from "@/ui";
import { createModelEngine, type ModelEngine, type ModelPart, type ModelView } from "./engine";

export type ModelViewState = "loading" | "running" | "no-webgl" | "load-error";
export type ModelViewerHandle = Omit<ModelEngine, "load" | "dispose">;

export interface ModelViewerProps {
  glbUrl: string | null;
  onParts(parts: ModelPart[]): void;
  onSelect(id: string | null): void;
  /** The view is loading, showing the model, could not start (no WebGL), or could not load the GLB. */
  onState?(s: ModelViewState): void;
}

/** What the workspace last asked for; replayed onto each new engine (a reload, a new GLB). */
interface Wanted {
  hidden: Set<string>;
  cut: number | null;
  levels: boolean;
  headOff: boolean;
  overlay: Float32Array | null;
  selected: string | null;
}

/** The React shell around `engine.ts`: the canvas, the notices, and the handle the workspace drives. */
export const ModelViewer = forwardRef<ModelViewerHandle, ModelViewerProps>(function ModelViewer(props, ref) {
  const { glbUrl } = props;
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

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = box.current;
    if (!glbUrl || !canvas || !host) return;
    let cancelled = false;
    let eng: ModelEngine;
    try {
      eng = createModelEngine({
        canvas,
        host,
        onSelect: (id) => {
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
    eng.load(glbUrl).then(
      (parts) => {
        if (cancelled) return;
        const w = wanted.current;
        for (const g of w.hidden) eng.setGroupVisible(g, false);
        eng.setCut(w.cut);
        eng.setLevels(w.levels);
        eng.setHeadOff(w.headOff);
        eng.setOverlay(w.overlay);
        setStatus({ key: sceneKey, state: "running" });
        cbs.current.onParts(parts);
      },
      () => {
        if (!cancelled) setStatus({ key: sceneKey, state: "load-error" });
      },
    );
    return () => {
      cancelled = true;
      if (engine.current === eng) engine.current = null;
      eng.dispose();
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
        engine.current?.select(id);
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
        engine.current?.setView(view);
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
      {state === "loading" && (
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
        >
          {notice}
        </div>
      )}
    </div>
  );
});
