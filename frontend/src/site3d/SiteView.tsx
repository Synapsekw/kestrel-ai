import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type * as THREE from "three";
import { useBackend } from "@/api/client";
import { absUrl, type SiteScene } from "@/api/siteScene";
import { NoWebGlError } from "@/clouds/viewer/engine";
import { Alert, Button, isTypingTarget } from "@/ui";
import type { PresetId } from "./engine/camera";
import { createSiteEngine } from "./engine/create";
import type { NavMode, SiteEngine } from "./engine/SiteEngine";
import type { SiteFrameT } from "./engine/siteTransform";
import { createDrawingLayer } from "./layers/drawing.layer";
import { createModelLayer, type ModelLayer, type ModelLoadInfo } from "./layers/model.layer";
import { createOrthoLayer } from "./layers/ortho.layer";
import type { SiteLayer } from "./layers/types";
import { loadFailureText } from "./loadError";
import { ViewTools } from "./panels/ViewTools";

export interface ModelStatus {
  url: string;
  state: "ready" | "error";
  info: ModelLoadInfo | null;
  /**
   * The loaded GLB scene (`ModelLayer.scene`), a new object per load or swap. On error it is what
   * stays shown: the old model after a failed swap, null when nothing ever loaded.
   */
  root: THREE.Object3D | null;
  /** Why the load failed (state "error"), in fixed words plus the HTTP status at most: never a URL. */
  error?: string;
}
export interface SiteViewHandle {
  clearSelection(): void;
  reload(): void;
  /** Moves focus to the view (after a card over it closes). */
  focus(): void;
}
/** The live engine and its layers, for S3's panels (ruling R-S3-4). */
export interface SiteEngineInfo {
  engine: SiteEngine;
  model: ModelLayer | null;
  layers: SiteLayer[];
}
export interface SiteViewProps {
  scene: SiteScene;
  frame: SiteFrameT;
  /** The plant model's GLB (`siteModelUrl`); a new URL for the same model swaps it in place. */
  modelUrl: string | null;
  /** Hidden layer ids: the model layer's and each drape's (`ortho:<id>`, `drawing:<id>`). */
  hidden: ReadonlySet<string>;
  onModel(s: ModelStatus): void;
  /** The 3D view could not start (null once a reload starts it). */
  onFailure?(kind: "no-webgl" | "failed" | null): void;
  /**
   * Fired when the engine starts, whenever its layer set changes, and with null when it goes.
   * S2's layers attach to `.engine`.
   */
  onEngine?(e: SiteEngineInfo | null): void;
  /** A drape whose tiles are gone (the map or drawing was removed); only while that layer is attached. */
  onLayerGone?(id: string): void;
}

/** The canvas, the engine's lifecycle, the layers from the manifest, and the view tools. */
export const SiteView = forwardRef<SiteViewHandle, SiteViewProps>(function SiteView(props, ref) {
  const { scene, frame, hidden, modelUrl } = props;
  const backend = useBackend();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const engine = useRef<SiteEngine | null>(null);
  const layers = useRef(new Map<string, SiteLayer>());
  const model = useRef<ModelLayer | null>(null);
  const cbs = useRef(props);
  useEffect(() => {
    cbs.current = props;
  });
  const announced = useRef<SiteEngine | null>(null);
  const announce = useCallback(() => {
    const eng = engine.current;
    if (!eng) {
      if (announced.current === null) return;
      announced.current = null;
      cbs.current.onEngine?.(null);
      return;
    }
    announced.current = eng;
    cbs.current.onEngine?.({ engine: eng, model: model.current, layers: [...layers.current.values()] });
  }, []);
  const [generation, setGeneration] = useState(0);
  const frameKey = JSON.stringify(frame);
  const engineKey = `${frameKey}#${generation}`;
  const [failure, setFailure] = useState<{ key: string; kind: "no-webgl" | "failed" } | null>(null);
  const failed = failure?.key === engineKey ? failure.kind : null;
  const [nav, setNav] = useState<NavMode>("orbit");
  const modelId = scene.model?.id ?? null;
  const [areas, setAreas] = useState<{ url: string; list: string[] } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let eng: SiteEngine;
    try {
      eng = createSiteEngine(canvas, JSON.parse(frameKey) as SiteFrameT);
    } catch (err) {
      const kind = err instanceof NoWebGlError ? "no-webgl" : "failed";
      setFailure({ key: engineKey, kind });
      cbs.current.onFailure?.(kind);
      return;
    }
    cbs.current.onFailure?.(null);
    engine.current = eng;
    const map = layers.current;
    announce();
    return () => {
      // a new engine starts with nothing selected; S3's panels drop theirs when the controls change
      eng.dispose();
      if (engine.current === eng) engine.current = null;
      map.clear();
      model.current = null;
      announce();
    };
  }, [frameKey, engineKey, announce]);

  // One layer per model id; a new version of the same model swaps in place (the next effect).
  useEffect(() => {
    const eng = engine.current;
    const url = cbs.current.modelUrl;
    if (!eng || !modelId || !url) return;
    const layer = createModelLayer({
      url,
      // `layer.scene` is read at call time, so a `load` swap reports the new root.
      onLoad: (info, u) => {
        setAreas({ url: u, list: info.areas });
        cbs.current.onModel({ url: u, state: "ready", info, root: layer.scene });
      },
      onError: (err, u) =>
        cbs.current.onModel({
          url: u,
          state: "error",
          info: null,
          root: layer.scene,
          // Fixed words: the loader's message names the token-bearing URL (never shown or logged).
          error: loadFailureText("The 3D model could not load", err),
        }),
    });
    layer.setVisible(!cbs.current.hidden.has(layer.id));
    layers.current.set(layer.id, layer);
    model.current = layer;
    eng.addLayer(layer);
    announce();
    const map = layers.current;
    return () => {
      eng.removeLayer(layer.id);
      if (map.get(layer.id) === layer) map.delete(layer.id);
      if (model.current === layer) model.current = null;
      announce();
    };
  }, [modelId, engineKey, announce]);

  // Ruling R-S3-10, the one swap path: the old model stays (onModel says "error") if the new one fails.
  useEffect(() => {
    const layer = model.current;
    if (!layer || !modelUrl || layer.url === modelUrl) return;
    layer.load(modelUrl).catch(() => {});
  }, [modelUrl]);

  const tileKey = JSON.stringify([
    scene.orthos.map((o) => [o.id, o.tile_url_template]),
    scene.drawings.map((d) => [d.id, d.tile_url_template]),
  ]);
  useEffect(() => {
    const eng = engine.current;
    if (!eng) return;
    const url = (rel: string) => absUrl(backend, rel);
    const { orthos, drawings } = cbs.current.scene;
    const map = layers.current;
    // onGone from a layer that was since detached or replaced is ignored.
    const make = (create: (onGone: () => void) => SiteLayer): SiteLayer => {
      let self: SiteLayer | null = null;
      self = create(() => {
        if (self && map.get(self.id) === self) cbs.current.onLayerGone?.(self.id);
      });
      return self;
    };
    const made = [
      ...orthos.map((o) => make((gone) => createOrthoLayer(o, url, gone))),
      ...drawings.map((d) => make((gone) => createDrawingLayer(d, url, gone))),
    ];
    for (const l of made) {
      l.setVisible(!cbs.current.hidden.has(l.id));
      map.set(l.id, l);
      eng.addLayer(l);
    }
    if (made.length > 0) announce();
    return () => {
      for (const l of made) {
        eng.removeLayer(l.id);
        if (map.get(l.id) === l) map.delete(l.id);
      }
      if (made.length > 0) announce();
    };
  }, [tileKey, engineKey, backend, announce]);

  const hiddenKey = [...hidden].sort().join(",");
  useEffect(() => {
    for (const l of layers.current.values()) l.setVisible(!cbs.current.hidden.has(l.id));
  }, [hiddenKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !isTypingTarget(e.target))
        engine.current?.select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useImperativeHandle(
    ref,
    (): SiteViewHandle => ({
      clearSelection: () => engine.current?.select(null),
      reload: () => setGeneration((g) => g + 1),
      focus: () => rootRef.current?.focus(),
    }),
    [],
  );

  const doNav = (m: NavMode) => {
    setNav(m);
    engine.current?.setNav(m);
  };
  const doPreset = (id: PresetId) => engine.current?.setPreset(id);

  return (
    <div
      ref={rootRef}
      role="region"
      aria-label="3D view"
      tabIndex={-1}
      className="absolute inset-0 outline-none"
      data-testid="site-view"
    >
      <canvas
        key={generation}
        ref={canvasRef}
        data-testid="site-canvas"
        className="absolute inset-0 h-full w-full bg-bg"
      />
      <div className="absolute left-3 top-3 z-10">
        <ViewTools
          nav={nav}
          onNav={doNav}
          onPreset={doPreset}
          areas={areas && areas.url === modelUrl ? areas.list : []}
          disabled={failed !== null}
        />
      </div>
      {failed && (
        <div className="absolute inset-x-0 bottom-6 z-10 mx-auto w-fit max-w-md px-4">
          {failed === "no-webgl" ? (
            <Alert tone="warn" role="alert">
              This computer can&apos;t start WebGL, so the 3D view is off. The layers list still works.
            </Alert>
          ) : (
            <Alert
              tone="danger"
              actions={
                <Button size="sm" icon="refresh" onClick={() => setGeneration((g) => g + 1)}>
                  Reload view
                </Button>
              }
            >
              The 3D view could not start.
            </Alert>
          )}
        </div>
      )}
    </div>
  );
});
