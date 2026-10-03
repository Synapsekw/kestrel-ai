import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useBackend } from "@/api/client";
import { absUrl, type SiteScene } from "@/api/siteScene";
import { NoWebGlError } from "@/clouds/viewer/engine";
import { Alert, Button, isTypingTarget } from "@/ui";
import type { PresetId } from "./engine/camera";
import { createSiteEngine } from "./engine/create";
import type { NavMode, SiteEngine } from "./engine/SiteEngine";
import type { SiteFrameT } from "./engine/siteTransform";
import { createDrawingLayer } from "./layers/drawing.layer";
import { createModelLayer, type ModelLoadInfo } from "./layers/model.layer";
import { createOrthoLayer } from "./layers/ortho.layer";
import type { PickHit, SiteLayer } from "./layers/types";
import { ViewTools } from "./panels/ViewTools";

export type LayerGroup = "model" | "ortho" | "drawing";
export interface ModelStatus {
  url: string;
  state: "ready" | "error";
  info: ModelLoadInfo | null;
}
export interface SiteViewHandle {
  clearSelection(): void;
  reload(): void;
  /** Moves focus to the view (after a card over it closes). */
  focus(): void;
}
export interface SiteViewProps {
  scene: SiteScene;
  frame: SiteFrameT;
  hidden: ReadonlySet<LayerGroup>;
  onSelect(hit: PickHit | null): void;
  onModel(s: ModelStatus): void;
  /** The 3D view could not start (null once a reload starts it). */
  onFailure?(kind: "no-webgl" | "failed" | null): void;
}

/** The canvas, the engine's lifecycle, the layers from the manifest, and the view tools. */
export const SiteView = forwardRef<SiteViewHandle, SiteViewProps>(function SiteView(props, ref) {
  const { scene, frame, hidden } = props;
  const backend = useBackend();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const engine = useRef<SiteEngine | null>(null);
  const layers = useRef(new Map<string, { group: LayerGroup; layer: SiteLayer }>());
  const cbs = useRef(props);
  useEffect(() => {
    cbs.current = props;
  });
  const [generation, setGeneration] = useState(0);
  const frameKey = JSON.stringify(frame);
  const engineKey = `${frameKey}#${generation}`;
  const [failure, setFailure] = useState<{ key: string; kind: "no-webgl" | "failed" } | null>(null);
  const failed = failure?.key === engineKey ? failure.kind : null;
  const [nav, setNav] = useState<NavMode>("orbit");
  const modelUrl = scene.model ? absUrl(backend, scene.model.glb_url) : null;
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
    const off = eng.onSelect((hit) => cbs.current.onSelect(hit));
    const map = layers.current;
    return () => {
      off();
      // dispose() drops listeners without emitting, so say the selection is gone.
      cbs.current.onSelect(null);
      eng.dispose();
      if (engine.current === eng) engine.current = null;
      map.clear();
    };
  }, [frameKey, engineKey]);

  useEffect(() => {
    const eng = engine.current;
    if (!eng || !modelUrl) return;
    const layer = createModelLayer({
      url: modelUrl,
      onLoad: (info) => {
        setAreas({ url: modelUrl, list: info.areas });
        cbs.current.onModel({ url: modelUrl, state: "ready", info });
      },
      onError: () => cbs.current.onModel({ url: modelUrl, state: "error", info: null }),
    });
    layer.setVisible(!cbs.current.hidden.has("model"));
    layers.current.set(layer.id, { group: "model", layer });
    eng.addLayer(layer);
    const map = layers.current;
    return () => {
      eng.removeLayer(layer.id);
      map.delete(layer.id);
      cbs.current.onSelect(null);
    };
  }, [modelUrl, engineKey]);

  const tileKey = JSON.stringify([
    scene.orthos.map((o) => [o.id, o.tile_url_template]),
    scene.drawings.map((d) => [d.id, d.tile_url_template]),
  ]);
  useEffect(() => {
    const eng = engine.current;
    if (!eng) return;
    const url = (rel: string) => absUrl(backend, rel);
    const { orthos, drawings } = cbs.current.scene;
    const made: Array<{ group: LayerGroup; layer: SiteLayer }> = [
      ...orthos.map((o) => ({ group: "ortho" as const, layer: createOrthoLayer(o, url) })),
      ...drawings.map((d) => ({ group: "drawing" as const, layer: createDrawingLayer(d, url) })),
    ];
    for (const m of made) {
      m.layer.setVisible(!cbs.current.hidden.has(m.group));
      layers.current.set(m.layer.id, m);
      eng.addLayer(m.layer);
    }
    const map = layers.current;
    return () => {
      for (const m of made) {
        eng.removeLayer(m.layer.id);
        map.delete(m.layer.id);
      }
    };
  }, [tileKey, engineKey, backend]);

  const hiddenKey = [...hidden].sort().join(",");
  useEffect(() => {
    for (const { group, layer } of layers.current.values()) layer.setVisible(!cbs.current.hidden.has(group));
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
