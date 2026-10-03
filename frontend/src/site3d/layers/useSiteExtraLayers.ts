import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type * as THREE from "three";
import { useApi, useBackend } from "@/api/client";
import { CLICK_SLOP_PX } from "@/clouds/cameras/useCanvasClicks";
import { writeBudget } from "@/clouds/viewer/budget";
import type { SiteEngine } from "@/site3d/engine/SiteEngine";
import type { SiteFrameT } from "@/site3d/engine/siteTransform";
import { useSeverityScale } from "@/ui";
import { createCloudHost } from "./cloudHost";
import { createCloudLayer, type CloudColour, type CloudLayer } from "./cloud.layer";
import { createFindingsLayer, type FindingsLayer } from "./findings.layer";
import { createPhotosLayer, type PhotosLayer } from "./photos.layer";
import { partsOf } from "./s1Bridge";
import type { SiteScene } from "./sceneTypes";
import { createSkyLayer } from "./sky.layer";
import type { StatusLayer } from "./status";
import { createWaterLayer, type WaterLayer } from "./water.layer";

export type ExtraGroup = "Point clouds" | "Environment" | "Data";
export interface ExtraLayerRow {
  id: string;
  label: string;
  group: ExtraGroup;
  layer: StatusLayer;
  visible: boolean;
}
export interface ExtraLayers {
  rows: ExtraLayerRow[];
  setVisible(id: string, v: boolean): void;
  cloudColour: CloudColour;
  setCloudColour(c: CloudColour): void;
  budget: number;
  setBudget(n: number): void;
  photos: PhotosLayer | null;
  findings: FindingsLayer | null;
}
/** Ruling 17: photos start off (clutter); everything else on. Clouds are `cloud:<id>` and default on. */
export const DEFAULT_ON: Readonly<Record<string, boolean>> = {
  water: true,
  sky: true,
  photos: false,
  findings: true,
};
const NO_OVERRIDES: Readonly<Record<string, boolean>> = {};

interface LayerSet {
  rows: Omit<ExtraLayerRow, "visible">[];
  clouds: CloudLayer[];
  water: WaterLayer;
  photos: PhotosLayer;
  findings: FindingsLayer;
}

const shownOf = (vis: Readonly<Record<string, boolean>>, id: string) => vis[id] ?? DEFAULT_ON[id] ?? true;

/**
 * S2's layers for one engine and one scene. A new engine gets new layer objects (R-S2-8), so a layer
 * is never shared across two engines; StrictMode's attach, detach, attach reuses one set on one engine.
 * `modelRoot` is the loaded GLB (`ModelStatus.root`), null before it loads.
 */
export function useSiteExtraLayers(o: {
  engine: SiteEngine | null;
  scene: SiteScene | null;
  frame: SiteFrameT | null;
  projectId: string;
  modelRoot: THREE.Object3D | null;
}): ExtraLayers {
  const api = useApi();
  const { baseUrl, token } = useBackend();
  const scale = useSeverityScale();
  const { engine, scene, frame, projectId, modelRoot } = o;
  const host = useMemo(() => createCloudHost(), []);
  const set = useMemo<LayerSet | null>(() => {
    if (!scene || !engine) return null;
    const clouds = scene.clouds.map((cloud) => createCloudLayer({ cloud, frame, baseUrl, token, host }));
    const sky = createSkyLayer();
    const water = createWaterLayer({ sun: sky.sun });
    const photos = createPhotosLayer({ api, projectId, frame, scene });
    const findings = createFindingsLayer({ api, projectId, frame, scene, scale });
    return {
      clouds,
      water,
      photos,
      findings,
      rows: [
        ...clouds.map((l) => ({ id: l.id, label: l.label, group: "Point clouds" as const, layer: l })),
        { id: water.id, label: water.label, group: "Environment", layer: water },
        { id: sky.id, label: sky.label, group: "Environment", layer: sky },
        { id: photos.id, label: photos.label, group: "Data", layer: photos },
        { id: findings.id, label: findings.label, group: "Data", layer: findings },
      ],
    };
  }, [engine, scene, frame, api, projectId, baseUrl, token, host, scale]);

  const [overrides, setOverrides] = useState<{ key: LayerSet | null; vis: Record<string, boolean> }>({
    key: null,
    vis: {},
  });
  const vis = overrides.key === set ? overrides.vis : NO_OVERRIDES;
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [cloudColour, setCloudColourState] = useState<CloudColour>("rgb");
  const [budget, setBudgetState] = useState(() => host.budget());

  useEffect(() => {
    if (!engine || !set) return;
    const offs = set.rows.map((r) => r.layer.status.subscribe(() => bump()));
    for (const r of set.rows) engine.addLayer(r.layer); // the engine's addLayer calls attach
    return () => {
      offs.forEach((off) => off());
      for (const r of set.rows) engine.removeLayer(r.id); // and removeLayer calls detach
    };
  }, [engine, set]);
  useEffect(() => {
    if (!set) return;
    for (const r of set.rows) r.layer.setVisible(shownOf(vis, r.id));
  }, [set, vis]);
  useEffect(() => {
    set?.water.setModel(modelRoot);
  }, [set, modelRoot]);
  useEffect(() => {
    set?.clouds.forEach((l) => l.setColour(cloudColour));
  }, [set, cloudColour]);

  return {
    rows: set ? set.rows.map((r) => ({ ...r, visible: shownOf(vis, r.id) })) : [],
    setVisible: (id, v) =>
      setOverrides((prev) => ({ key: set, vis: { ...(prev.key === set ? prev.vis : {}), [id]: v } })),
    cloudColour,
    setCloudColour: setCloudColourState,
    budget,
    setBudget(n) {
      host.setBudget(n);
      writeBudget(n);
      setBudgetState(n);
      if (engine) partsOf(engine).requestRender();
    },
    photos: set?.photos ?? null,
    findings: set?.findings ?? null,
  };
}

/** A click (at most `CLICK_SLOP_PX` of travel) on a pin opens its finding, else on a glyph opens its photo. */
export function useExtraLayerClicks(
  engine: SiteEngine | null,
  extra: Pick<ExtraLayers, "photos" | "findings">,
  on: { photo(imageId: string): void; finding(findingId: string): void },
): void {
  const onRef = useRef(on);
  useEffect(() => {
    onRef.current = on;
  });
  const { photos, findings } = extra;
  useEffect(() => {
    if (!engine) return;
    const canvas = partsOf(engine).canvas;
    let down: { x: number; y: number } | null = null;
    const pd = (e: PointerEvent) => {
      down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    };
    const pu = (e: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP_PX) return;
      const f = findings?.hit(e.clientX, e.clientY);
      if (f) return onRef.current.finding(f.findingId);
      const p = photos?.hit(e.clientX, e.clientY);
      if (p) onRef.current.photo(p.imageId);
    };
    canvas.addEventListener("pointerdown", pd);
    canvas.addEventListener("pointerup", pu);
    return () => {
      canvas.removeEventListener("pointerdown", pd);
      canvas.removeEventListener("pointerup", pu);
    };
  }, [engine, photos, findings]);
}
