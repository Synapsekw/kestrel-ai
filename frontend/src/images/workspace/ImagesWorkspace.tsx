import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { setMarkedEmpty, type ImageDetail } from "@/api/images";
import { useProject } from "@/api/project";
import { useProvideRouteActions, type RouteAction } from "@/app/routeActions";
import { EmptyImages } from "@/data/EmptyImages";
import { ImportImagesDialog } from "@/data/ImportImagesDialog";
import { labelNext, type LabelNext } from "@/data/labelNext";
import { EMPTY_SELECTION, pruneSelection, type SelectionState } from "@/data/selection";
import { useChangesStore } from "@/store/changes";
import {
  Alert,
  GlassPanel,
  InspectorLayout,
  cx,
  stagger,
  toast,
  useReducedMotion,
  useSeverityScale,
} from "@/ui";
import { stripKeys } from "./arrival";
import { ArrivalMarker, ArrivalProbe, BackTo3DChip } from "./ArrivalMarker";
import { useArrivalStore } from "./arrivalStore";
import { BrowserPane, type BrowserMode } from "./BrowserPane";
import { ENTRY_KEYS, parseEntry, type Preset } from "./entryParams";
import { footprintInput } from "./footprint";
import { InfoChip } from "./InfoChip";
import { InspectorColumn } from "./InspectorColumn";
import { KEYS_NOTICE, showKeysNoticeOnce } from "./keysNotice";
import { MeasureReadout } from "./MeasureReadout";
import { shapeBounds } from "./panTo";
import {
  AiBar,
  AiDetectButton,
  AiHosts,
  applyPreset,
  batchScopeOf,
  BatchDetectDialog,
  BatchDetectWatch,
  DEFAULT_BROWSER_FILTERS,
  ensureAiRegistered,
  FC_RENDERS,
  Filmstrip,
  HintBar,
  ImageCanvas,
  indexNeighbours,
  SamWarmEdge,
  SmartPolygonPanel,
  statusHintsFor,
  SuggestionChip,
  SuggestionsLayer,
  ToolPalette,
  useActiveTool,
  useAiWorkspace,
  useCanvasKeyHandlers,
  useCommandContext,
  useDetail,
  useHeldKeys,
  useImageData,
  useImageIndex,
  useImagesKeymap,
  useImagesWorkspace,
  useImageUrl,
  useLoadedFrame,
  useSaveState,
  useScale,
  useSelection,
  ZoomCluster,
  type BrowserFilterState,
  type KeyHandlers,
} from "./seams";
import { StatusBar } from "./StatusBar";
import { reviewedCount, statusHints } from "./statusHints";
import { useArrival } from "./useArrival";
import { useFrameGuard } from "./useFrameGuard";
import { useInspectorModel } from "./useInspectorModel";
import { useMinWidth } from "./useMinWidth";

// FA: registers its key rows and the S tool before FC's keymap first reads them (idempotent).
ensureAiRegistered();

const LABEL_NEXT: Record<Exclude<LabelNext, { imageId: string }>, string> = {
  "all-labeled": "Every image has labels. Build a dataset from Models.",
  "no-images": "No images to label yet.",
  failed: "Couldn't find the next image to label. Try again.",
};
/** Ruling 3: the narrow-width overlays (not GlassPanels, so `bg-glass-solid`). */
const OVERLAY =
  "absolute top-3 bottom-12 z-20 overflow-y-auto rounded-panel bg-glass-solid shadow-elev-2 animate-slide-in reduce-motion:animate-none";

function filtersFor(preset: Preset): BrowserFilterState {
  if (preset === "suggestions") return applyPreset("suggestions");
  if (preset === "unlabeled") return { ...DEFAULT_BROWSER_FILTERS, unlabeled: true };
  return DEFAULT_BROWSER_FILTERS;
}

/**
 * FC's `useImageData` loads one frame into FC's store (nothing else calls it, so a frame is read
 * once); mounted only while an image is open, so the bare tab and an empty project read no image.
 * Ruling 13: a frame that fails to load shows the error in the centre pane.
 */
function FrameGate({
  projectId,
  imageId,
  children,
}: {
  projectId: string;
  imageId: string;
  children: ReactNode;
}) {
  const { error } = useImageData(projectId, imageId);
  if (error)
    return (
      <div className="grid h-full place-items-center p-6">
        <Alert tone="danger">{error}</Alert>
      </div>
    );
  return <>{children}</>;
}

/** The Images tab (§6): browser | canvas | inspector over a status bar; one mount for every image. */
export function ImagesWorkspace() {
  const { projectId = "", imageId: routeImageId } = useParams();
  const imageId = routeImageId ?? null;
  const api = useApi();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const search = params.toString();
  const { project } = useProject(projectId);
  const scale = useSeverityScale();
  const reduced = useReducedMotion();

  const [filters, setFilters] = useState<BrowserFilterState>(DEFAULT_BROWSER_FILTERS);
  const [mode, setMode] = useState<BrowserMode>("grid");
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION);
  const [batch, setBatch] = useState<{ ids: string[] | null } | null>(null);
  const [importing, setImporting] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const wide = useMinWidth(1100);
  const roomy = useMinWidth(960);
  const distanceRef = useRef<HTMLInputElement>(null);

  // Budget: the one index read of the workspace; the grid, map, filmstrip and keys all share it.
  const index = useImageIndex(projectId, filters);
  const ready = index.status === "ready";
  const detail = useDetail();
  const frame = useLoadedFrame(imageId);
  const model = useInspectorModel(projectId, imageId);
  const ctx = useCommandContext(projectId);
  const imageUrl = useImageUrl(projectId);
  const { boxes, boxesLoaded, select } = useSelection();
  const save = useSaveState();
  const tool = useActiveTool();
  const zoom = useScale();
  const nb = indexNeighbours(index, imageId);
  const reviewed = useMemo(() => reviewedCount(index.flags), [index.flags]);
  const dialogOpen = importing || batch !== null;
  const setDetail = useCallback((d: ImageDetail) => useImagesWorkspace.getState().setImage(d), []);
  // I-FB hand-off: Delete and Detect act only on images the current filters still list.
  const shownSelection = useMemo(
    () => (selection.selected.size === 0 ? selection : pruneSelection(selection, [...index.ids])),
    [selection, index.ids],
  );

  const open = useCallback(
    (id: string) => void navigate(`/p/${projectId}/images/${id}`),
    [navigate, projectId],
  );

  // Ruling 4: entry parameters, once, then dropped (the arrival parameters are useArrival's). State
  // is adjusted during render (the repo's `set-state-in-effect` rule), the URL in an effect.
  const entry = parseEntry(new URLSearchParams(search));
  const [entryHandled, setEntryHandled] = useState<string | null>(null);
  if (entry && entryHandled !== search) {
    setEntryHandled(search);
    if (entry.preset) setFilters(filtersFor(entry.preset));
    if (entry.batch) setBatch({ ids: null });
  } else if (!entry && entryHandled !== null) setEntryHandled(null);
  const hasEntry = entry !== null;
  useEffect(() => {
    if (parseEntry(new URLSearchParams(search)))
      setParams((prev) => stripKeys(prev, ENTRY_KEYS), { replace: true });
  }, [search, setParams]);

  // Ruling 2: the bare tab opens the first frame of the (filtered) index, once no entry key is left.
  useEffect(() => {
    if (imageId || hasEntry || !ready || index.ids.length === 0) return;
    void navigate(`/p/${projectId}/images/${index.ids[0]}`, { replace: true });
  }, [imageId, hasEntry, ready, index.ids, navigate, projectId]);

  useArrival({
    projectId,
    imageId,
    width: detail?.width ?? 0,
    height: detail?.height ?? 0,
    // I2: THIS mount's load of the frame, not a copy FC's store kept from an earlier visit.
    ready: frame !== null && boxesLoaded,
    onOpenInspector: () => setInspectorOpen(true),
  });
  // A filter change re-queries the index (status "loading", so null here), which resets the guard:
  // a frame the new filters exclude was not deleted. A re-read after images.changed stays ready.
  useFrameGuard(projectId, imageId, ready ? index.ids : null);
  useEffect(() => showKeysNoticeOnce(() => toast("info", KEYS_NOTICE)), []);

  const aiIndex = useMemo(
    () => (ready ? { ids: index.ids, flags: index.flags } : null),
    [ready, index.ids, index.flags],
  );
  const ai = useAiWorkspace({ projectId, index: aiIndex, onOpenImage: open });

  const toggleEmpty = useCallback(async () => {
    if (!detail) return;
    try {
      // PATCH answers the image row (no camera or footprint): merge it over the detail FC holds.
      const row = await setMarkedEmpty(api, projectId, detail.id, !detail.marked_empty);
      setDetail({ ...detail, ...row });
      useChangesStore.getState().bumpImages();
    } catch (e) {
      toast("danger", messageOf(e, "Could not update the image. Try again."));
    }
  }, [api, detail, projectId, setDetail]);

  const focusComment = useCallback(() => {
    if (!wide) setInspectorOpen(true);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLTextAreaElement>('[data-testid="inspector-column"] textarea[aria-label="Reply"]')
        ?.focus(),
    );
  }, [setInspectorOpen, wide]);

  const setDistance = useCallback(() => {
    select(null);
    if (!wide) setInspectorOpen(true);
    requestAnimationFrame(() => distanceRef.current?.focus());
  }, [select, setInspectorOpen, wide]);

  const showOnImage = useCallback(
    (boxId: string) => {
      const box = boxes[boxId];
      if (!box) return;
      select(boxId);
      useImagesWorkspace.getState().panIntoView(shapeBounds(box), { animate: !reduced });
    },
    [boxes, reduced, select],
  );

  // Keys: FC's rows already hold FW's actions; FW supplies their handlers as the last layer, FA's
  // go first (FA R-FA15). A handler returning false hands the key on (FC-R11).
  const canvasKeys = useCanvasKeyHandlers(ctx);
  const fwKeys = useMemo<KeyHandlers>(
    () => ({
      "previous-image": () => (nb.prev ? open(nb.prev) : false),
      "next-image": () => (nb.next ? open(nb.next) : false),
      "grid-map": () => setMode((m) => (m === "grid" ? "map" : "grid")),
      "nothing-to-report": () => void toggleEmpty(),
      "focus-comment": () => focusComment(),
      "toggle-browser": () => (roomy ? false : setBrowserOpen((o) => !o)),
      "toggle-inspector": () => (wide ? false : setInspectorOpen((o) => !o)),
    }),
    [
      focusComment,
      nb.next,
      nb.prev,
      open,
      roomy,
      setBrowserOpen,
      setInspectorOpen,
      setMode,
      toggleEmpty,
      wide,
    ],
  );
  useImagesKeymap([ai.keyHandlers, canvasKeys, fwKeys], { enabled: !dialogOpen });
  useHeldKeys();

  // Esc is F's global cancel; FW only listens (never preventDefault) to clear the arrival ring.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") useArrivalStore.getState().clearMarker();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Ruling 17: Label next and Import images in the top bar.
  const onLabelNext = useCallback(async () => {
    const next = await labelNext(api, projectId);
    if (typeof next === "object") open(next.imageId);
    else toast(next === "failed" ? "danger" : "info", LABEL_NEXT[next]);
  }, [api, open, projectId]);
  const actions = useMemo<RouteAction[]>(
    () => [
      { id: "label-next", label: "Label next", icon: "label", run: () => void onLabelNext() },
      {
        id: "import-images",
        label: "Import images",
        icon: "import",
        run: () => setImporting(true),
        disabled: !project,
      },
    ],
    [onLabelNext, project, setImporting],
  );
  useProvideRouteActions(actions);

  const filtered = JSON.stringify(filters) !== JSON.stringify(DEFAULT_BROWSER_FILTERS);
  const browser = (
    <BrowserPane
      projectId={projectId}
      imageId={imageId}
      index={index}
      filters={filters}
      onFilters={setFilters}
      mode={mode}
      onMode={setMode}
      selection={shownSelection}
      onSelection={setSelection}
      footprint={footprintInput(detail)}
      onOpen={open}
      onDetect={(ids) => setBatch({ ids })}
    />
  );
  const inspector = (
    <InspectorColumn
      projectId={projectId}
      model={model}
      detail={detail}
      onDetail={setDetail}
      distanceRef={distanceRef}
      onShowOnImage={showOnImage}
    />
  );
  const centre = (
    <GlassPanel
      as="section"
      variant="pane"
      aria-label="Image canvas"
      style={stagger(1)}
      className="stagger relative flex h-full min-h-0 flex-col overflow-hidden animate-rise reduce-motion:animate-none"
    >
      <div className="relative min-h-0 flex-1 bg-bg">
        {imageId ? (
          <FrameGate projectId={projectId} imageId={imageId}>
            <ImageCanvas
              projectId={projectId}
              types={project?.classes ?? []}
              imageUrl={imageUrl}
              neighbourIds={[nb.prev, nb.next].filter((id): id is string => id !== null)}
              suggestions={<SuggestionsLayer />}
              overlay={<ArrivalMarker imageId={imageId} scale={zoom} />}
              onShapeCreated={(r) => {
                if (r.finding_id && !wide) setInspectorOpen(true);
              }}
            >
              {/* FC's canvas container is `position: relative` (SamWarmEdge and the chips rely on it). */}
              <SamWarmEdge />
              <div className="absolute left-3 top-3 z-10 flex flex-col items-start gap-2">
                <ToolPalette ctx={ctx}>
                  <AiDetectButton projectId={projectId} />
                </ToolPalette>
                <SmartPolygonPanel />
              </div>
              <ZoomCluster className="absolute right-3 top-3 z-10" />
              {!FC_RENDERS.infoChip && <InfoChip detail={detail} onSetDistance={setDistance} />}
              {!FC_RENDERS.measureReadout && <MeasureReadout camera={detail?.camera} />}
              <BackTo3DChip projectId={projectId} imageId={imageId} />
              <ArrivalProbe imageId={imageId} />
              <AiBar />
              <HintBar />
              <SuggestionChip />
            </ImageCanvas>
          </FrameGate>
        ) : ready && index.total === 0 ? (
          <div className="grid h-full place-items-center">
            <EmptyImages
              filtered={filtered}
              onImport={() => setImporting(true)}
              onClearFilters={() => setFilters(DEFAULT_BROWSER_FILTERS)}
            />
          </div>
        ) : null}
      </div>
      <Filmstrip projectId={projectId} index={index} currentId={imageId} onOpen={open} />
    </GlassPanel>
  );

  return (
    <div className="relative grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-y-2.5 px-3.5 pt-3">
      <h1 className="sr-only">Images</h1>
      <div className={cx("grid min-h-0 gap-3", roomy ? "grid-cols-[280px_minmax(0,1fr)]" : "grid-cols-1")}>
        {roomy && (
          <div style={stagger(0)} className="stagger min-h-0 animate-rise reduce-motion:animate-none">
            {browser}
          </div>
        )}
        <InspectorLayout
          inspector={
            wide ? (
              <div
                style={stagger(2)}
                className="stagger min-h-0 overflow-y-auto animate-rise reduce-motion:animate-none"
              >
                {inspector}
              </div>
            ) : null
          }
        >
          {centre}
        </InspectorLayout>
      </div>
      <StatusBar
        hints={statusHints(statusHintsFor(tool), scale.length)}
        position={nb.ordinal >= 0 ? nb.ordinal + 1 : null}
        total={index.total}
        reviewed={reviewed}
        save={save.state}
        onRetry={save.retry}
        className="-mx-3.5"
      />
      {!roomy && browserOpen && <div className={cx(OVERLAY, "left-3 w-[280px]")}>{browser}</div>}
      {!wide && inspectorOpen && <div className={cx(OVERLAY, "right-3 w-[340px]")}>{inspector}</div>}
      {importing && project && (
        <ImportImagesDialog
          project={project}
          onClose={() => setImporting(false)}
          onStarted={() => {
            setImporting(false);
            useChangesStore.getState().bumpImages();
          }}
        />
      )}
      {batch && (
        <BatchDetectDialog
          projectId={projectId}
          open
          onClose={() => setBatch(null)}
          {...batchScopeOf(filters, batch.ids, index.total)}
        />
      )}
      {/* FA: always mounted, once, whatever is open (the S session, the bulk confirm, run outcomes). */}
      <AiHosts projectId={projectId} />
      <BatchDetectWatch onReview={() => setFilters(applyPreset("suggestions"))} />
    </div>
  );
}
