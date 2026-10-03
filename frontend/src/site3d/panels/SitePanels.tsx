import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import * as THREE from "three";
import type { SiteScene } from "@/api/siteScene";
import type { AssetItem, AssetItemRow } from "@/api/plantItems";
import { useAssetModelList } from "@/assetmodels/useAssetModels";
import { plantToScene, siteToScene, type SiteFrameT } from "@/site3d/engine/siteTransform";
import { modelDetailsHref, readSiteAt } from "@/site3d/entry/links";
import { extraRows, s1Rows, type ModelState } from "@/site3d/layerRows";
import type { SiteLayer } from "@/site3d/layers/types";
import type { ExtraLayers } from "@/site3d/layers/useSiteExtraLayers";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { Alert, Pill, Progress } from "@/ui";
import type { ColourBy, SiteControls } from "./engineBridge";
import { ItemEditor } from "./ItemEditor";
import { ItemPanel } from "./ItemPanel";
import { LayersPanel } from "./LayersPanel";
import { RegisterPanel } from "./RegisterPanel";
import { RunBar } from "./RunBar";
import { useCatalogue } from "./useCatalogue";
import { useDiscardGuard } from "./useDiscardGuard";

/** The plant model as the 3D view has it (SiteScreen's model status). */
export interface SiteModelView {
  /** The version the view was asked to show; null without a model. */
  version: number | null;
  /** The version on screen: the old one after a failed swap; null before anything loaded. */
  shown: number | null;
  /** The asked-for version's state. */
  state: ModelState;
  items: number;
  /** Why the asked-for version did not load. */
  error?: string | null;
}

export interface SitePanelsProps {
  projectId: string;
  scene: SiteScene;
  frame: SiteFrameT | null;
  /** null until S1's engine runs (no WebGL: the panels still list the register). */
  controls: SiteControls | null;
  s1Layers: readonly SiteLayer[];
  extra: ExtraLayers;
  view: SiteModelView;
  /** Asks the view to show another version of the model (SiteView swaps it, ruling R-S3-10). */
  onShowVersion(version: number): void;
  /** S1 layer ids switched off (SiteView applies them; a rebuilt layer keeps its switch). */
  hidden: ReadonlySet<string>;
  onHidden(id: string, hidden: boolean): void;
  /** S1 layers whose map or drawing was removed. */
  gone: ReadonlySet<string>;
}

/** A row's fly-to box when the model layer has no node box: 30 m around the footprint point, base to top. */
export function rowBox(frame: SiteFrameT, row: AssetItemRow): THREE.Box3 | null {
  if (row.plant_e == null || row.plant_n == null) return null;
  const base = row.base_el ?? frame.datum.el_m;
  const top = row.top_el ?? base + 10;
  const [x, y0, z] = plantToScene(frame, row.plant_e, row.plant_n, base);
  const y1 = y0 + Math.max(2, top - base);
  return new THREE.Box3(new THREE.Vector3(x - 15, y0, z - 15), new THREE.Vector3(x + 15, y1, z + 15));
}

type SwapPhase = { kind: "building" } | { kind: "loading" } | { kind: "failed"; message: string } | null;

const BUILD_FAILED = "The new version's 3D model could not be built.";

/** Spec §11 panels over S1's view: Layers (top left), Register / Item / Edit (right), Run (bottom left). */
export function SitePanels(p: SitePanelsProps) {
  const location = useLocation();
  const catalogue = useCatalogue();
  const { models } = useAssetModelList(p.projectId);
  const sceneModel = p.scene.model;
  const model = sceneModel ? (models?.find((m) => m.id === sceneModel.id) ?? null) : null;
  /** The version the register, the item and the editor read: the one on screen. */
  const version = sceneModel ? (p.view.shown ?? sceneModel.version) : null;

  // ---- layers
  const [opacity, setOpacity] = useState<Record<string, number>>({});
  const [colourBy, setColourBy] = useState<ColourBy>("material");
  const visible = Object.fromEntries(p.s1Layers.map((l) => [l.id, !p.hidden.has(l.id)]));
  const rows = [
    ...s1Rows(p.s1Layers, {
      visible,
      opacity,
      gone: p.gone,
      model: { state: p.view.state, items: p.view.items, version: p.view.version, shown: p.view.shown },
    }),
    ...extraRows(p.extra.rows),
  ];
  const s1 = useMemo(() => new Map(p.s1Layers.map((l) => [l.id, l])), [p.s1Layers]);
  const onVisible = (id: string, v: boolean) => {
    const l = s1.get(id);
    if (l) {
      l.setVisible(v);
      p.onHidden(id, !v);
    } else if (p.extra.rows.some((r) => r.id === id)) p.extra.setVisible(id, v);
  };
  const onOpacity = (id: string, o: number) => {
    const l = s1.get(id);
    if (!l?.setOpacity) return;
    l.setOpacity(o);
    setOpacity((u) => ({ ...u, [id]: o }));
  };
  const placeableCloud = p.extra.rows.some(
    (r) => r.group === "Point clouds" && r.layer.status.get().kind !== "unavailable",
  );

  // ---- the GLB swap after a saved edit: the build job, then the view loads it (or keeps the old one).
  // The phase is derived from the job and the view's report; only the saved version is state.
  const [swap, setSwap] = useState<{ version: number; jobId: string } | null>(null);
  const job = useJobsStore((s) => (swap ? (s.jobs[swap.jobId] ?? null) : null));
  const built = swap !== null && job?.state === "succeeded";
  const showVersion = useRef(p.onShowVersion);
  useEffect(() => {
    showVersion.current = p.onShowVersion;
  });
  const asked = useRef<number | null>(null);
  useEffect(() => {
    if (!built || !swap || asked.current === swap.version) return;
    asked.current = swap.version;
    showVersion.current(swap.version);
  }, [built, swap]);
  const phase: SwapPhase = !swap
    ? null
    : !job || isActiveJob(job)
      ? { kind: "building" }
      : job.state !== "succeeded"
        ? { kind: "failed", message: `${BUILD_FAILED}${job.error ? ` ${job.error}` : ""}` }
        : p.view.version !== swap.version || p.view.state === "loading"
          ? { kind: "loading" }
          : p.view.state === "ready"
            ? null
            : { kind: "failed", message: p.view.error ?? "" };

  // ---- selection and editing
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<AssetItem | null>(null);
  const [dirty, setDirty] = useState(false);
  const { guard, dialog } = useDiscardGuard(dirty && editing !== null, editing?.name ?? "this item");
  const open = useCallback((id: string | null) => {
    setEditing(null);
    setDirty(false);
    setSelectedId(id);
  }, []);
  const guardRef = useRef(guard);
  const selectedRef = useRef(selectedId);
  useEffect(() => {
    guardRef.current = guard;
    selectedRef.current = selectedId;
  });
  // S1's ModelLayer.select re-broadcasts to every onSelect listener; a selection made here is not
  // heard back as a new 3D click (S3-9 minor 3: pick → select → onSelect → open would run twice).
  const quiet = useRef(false);
  const selectIn3d = (node: string | null) => {
    quiet.current = true;
    try {
      p.controls?.select(node);
    } finally {
      quiet.current = false;
    }
  };
  useEffect(() => {
    if (!p.controls) return;
    return p.controls.onSelect((node) => {
      if (quiet.current || node === selectedRef.current) return;
      guardRef.current(() => open(node));
    });
  }, [p.controls, open]);
  // A new or gone view (a reload makes a new engine with nothing selected): drop the selection too,
  // unless it holds unsaved edits.
  const dirtyRef = useRef(dirty);
  const lastControls = useRef(p.controls);
  useEffect(() => {
    dirtyRef.current = dirty;
  });
  useEffect(() => {
    const before = lastControls.current;
    lastControls.current = p.controls;
    if (before !== null && before !== p.controls && !dirtyRef.current) open(null);
  }, [p.controls, open]);
  const pick = (node: string, row: AssetItemRow) =>
    guard(() => {
      const box = p.controls?.boxOf(node) ?? (p.frame ? rowBox(p.frame, row) : null);
      if (box) p.controls?.flyTo(box);
      selectIn3d(node);
      open(node);
    });

  // ---- ?at= arrival (Ruling 14), once, after the model's first fit (R-S3-18); only in the site's CRS
  const at = useMemo(() => readSiteAt(location.search), [location.search]);
  const arrived = useRef(false);
  const settled = !sceneModel || p.view.state !== "loading";
  useEffect(() => {
    if (arrived.current || !at || !p.controls || !p.frame || !settled) return;
    arrived.current = true;
    if (at.epsg === null || at.epsg !== p.frame.crs.epsg) return;
    const [x, y, z] = siteToScene(p.frame, at.x, at.y, p.frame.datum.el_m);
    p.controls.flyTo(
      new THREE.Box3(new THREE.Vector3(x - 60, y - 5, z - 60), new THREE.Vector3(x + 60, y + 40, z + 60)),
    );
  }, [at, p.controls, p.frame, settled]);

  const notice =
    phase?.kind === "building" && swap ? (
      <Alert tone="info" title={`Building version ${swap.version}…`}>
        <Progress
          thin
          running
          value={job?.progress ?? undefined}
          label="Building the 3D model"
          className="mt-2"
        />
      </Alert>
    ) : phase?.kind === "loading" && swap ? (
      <Alert tone="info" title={`Loading version ${swap.version}…`}>
        <Progress thin running label="Loading the 3D model" className="mt-2" />
      </Alert>
    ) : phase?.kind === "failed" && swap ? (
      <Alert
        tone="danger"
        role="alert"
        title={`Version ${swap.version}'s 3D model could not load.`}
        onDismiss={() => setSwap(null)}
      >
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <Pill size="sm" tone="warn">
            Stale
          </Pill>
          {`${p.view.shown !== null ? `You are seeing version ${p.view.shown}. ` : ""}${phase.message}`}
        </p>
      </Alert>
    ) : null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div className="absolute left-[64px] top-3">
        <LayersPanel
          rows={rows}
          onVisible={onVisible}
          onOpacity={onOpacity}
          colourBy={colourBy}
          onColourBy={(c) => {
            setColourBy(c);
            p.controls?.setColourBy(c);
          }}
          cloudColour={placeableCloud ? p.extra.cloudColour : null}
          onCloudColour={p.extra.setCloudColour}
          budget={placeableCloud ? p.extra.budget : null}
          onBudget={p.extra.setBudget}
        />
      </div>
      {sceneModel && version !== null && (
        <aside
          aria-label="Plant register"
          className="pointer-events-auto absolute bottom-3 right-3 top-3 flex w-[340px] flex-col gap-3 rounded-panel border border-glass-line bg-glass-solid p-3 shadow-elev-2 animate-slide-in reduce-motion:animate-none"
        >
          <header className="flex items-baseline gap-2">
            <span className="min-w-0 truncate text-sm font-semibold text-ink">
              {model?.name ?? "Plant model"}
            </span>
            <span className="shrink-0 font-mono text-xs tabular-nums text-muted">{`Version ${version}`}</span>
            <Link
              className="ml-auto shrink-0 text-xs text-accent-ink underline-offset-2 hover:underline"
              to={modelDetailsHref(p.projectId, sceneModel.id)}
            >
              Model details
            </Link>
          </header>
          {editing ? (
            <ItemEditor
              key={`${editing.id}@${version}`}
              projectId={p.projectId}
              modelId={sceneModel.id}
              baseVersion={version}
              item={editing}
              catalogue={catalogue}
              onDirty={setDirty}
              onCancel={() => guard(() => open(selectedId))}
              onSaved={(saved, jobId) => {
                // Clear the unsaved state first, so nothing after the save asks to discard it.
                setDirty(false);
                setEditing(null);
                setSwap({ version: saved, jobId });
              }}
            />
          ) : selectedId ? (
            <ItemPanel
              projectId={p.projectId}
              modelId={sceneModel.id}
              version={version}
              itemId={selectedId}
              onBack={() => {
                selectIn3d(null);
                open(null);
              }}
              onEdit={setEditing}
            />
          ) : (
            <RegisterPanel
              projectId={p.projectId}
              modelId={sceneModel.id}
              version={version}
              catalogueTypes={catalogue.map((c) => c.type)}
              selectedId={selectedId}
              onPick={pick}
            />
          )}
        </aside>
      )}
      {notice && (
        <div className="pointer-events-auto absolute left-1/2 top-3 w-full max-w-md -translate-x-1/2 rounded-control bg-glass-solid shadow-elev-2">
          {notice}
        </div>
      )}
      {model && (
        <div className="absolute bottom-3 left-3 right-[364px] flex justify-start">
          <RunBar projectId={p.projectId} model={model} />
        </div>
      )}
      {dialog}
    </div>
  );
}
