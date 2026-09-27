import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { useCommands } from "@/app/commands";
import { Alert, Button, Dialog, GlassPanel, Skeleton, cx, toast, type Command } from "@/ui";
import { arrivalRequest } from "./arrival/arrival";
import { CoordinatesPanel } from "./chrome/CoordinatesPanel";
import { LayersPanel } from "./chrome/LayersPanel";
import { NavControls } from "./chrome/NavControls";
import { ToolHint } from "./chrome/ToolHint";
import { ToolPalette } from "./chrome/ToolPalette";
import { WorkspaceEmpty } from "./chrome/WorkspaceEmpty";
import {
  WorkspaceProvider,
  useTools,
  useWorkspace,
  useWorkspaceStores,
  type WorkspaceStores,
} from "./context";
import { InspectorHost } from "./inspect/InspectorHost";
import { inspectorRegistry } from "./inspect/inspectorRegistry";
import { layerRegistry, type LayerRowsContext } from "./layers/layerRegistry";
import { placeLayers } from "./layers/placement";
import { PanelSlotHost } from "./panels/PanelSlotHost";
import "./plugins";
import { useRegistry } from "./registry";
import { usePersist } from "./state/usePersist";
import { useUrlState } from "./state/useUrlState";
import { useWorkspaceData, type WorkspaceData } from "./state/useWorkspaceData";
import { createWorkspaceStore, PLAY_STEP_MS } from "./state/workspaceStore";
import { createToolStore, shortcutFor, toolRegistry } from "./tools/toolStore";
import { useWorkspaceKeys } from "./tools/useWorkspaceKeys";
import type { Selection } from "./types";
import { SiteMap } from "./view/SiteMap";
import { siteCode } from "./view/siteFrame";
import type { SiteExtent } from "./view/siteGrid";

function Stage({ children }: { children: ReactNode }) {
  return (
    <div data-testid="map-workspace" className="relative h-full w-full overflow-hidden bg-bg">
      {children}
    </div>
  );
}

function Problem({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <GlassPanel
        variant="float"
        radius="panel"
        className="flex w-[420px] max-w-[calc(100%-32px)] flex-col gap-3 p-4"
      >
        <Alert tone="danger">{message}</Alert>
        <Button className="self-start" onClick={onRetry}>
          Retry
        </Button>
      </GlassPanel>
    </div>
  );
}

/** The Maps tab (spec §5): the full-bleed map workspace. */
export function MapWorkspace() {
  const { projectId = "" } = useParams();
  const { data, error, retry } = useWorkspaceData(projectId);
  // One pair of stores per project; a project switch starts fresh.
  const stores = useMemo(
    () => ({ workspace: createWorkspaceStore(), tools: createToolStore() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new project gets new stores
    [projectId],
  );
  const frame = data?.frame ?? null;
  const value = useMemo<WorkspaceStores | null>(
    () => (frame ? { ...stores, projectId, frame } : null),
    // The frame object is new on every re-read; its identity is its code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stores, projectId, frame && `${frame.kind}|${frame.epsg}|${frame.proj4}`],
  );

  if (!data || !value)
    return (
      <Stage>
        {error ? (
          <Problem message={error} onRetry={retry} />
        ) : (
          <div role="status" aria-label="Loading the map" className="absolute inset-4">
            <Skeleton className="h-full w-full rounded-panel" />
          </div>
        )}
      </Stage>
    );
  if (data.frame.kind === "crs" && !data.frame.proj4)
    return (
      <Stage>
        <Problem message="The site coordinate system could not be read." onRetry={retry} />
      </Stage>
    );
  return (
    <WorkspaceProvider value={value}>
      <WorkspaceBody data={data} />
    </WorkspaceProvider>
  );
}

function unionExtent(extents: readonly SiteExtent[]): SiteExtent | null {
  if (extents.length === 0) return null;
  return extents.reduce<SiteExtent>(
    (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])],
    [...extents[0]],
  );
}

function WorkspaceBody({ data }: { data: WorkspaceData }) {
  const { workspace, projectId, frame } = useWorkspaceStores();
  const api = useApi();
  const location = useLocation();

  // Hydrate before the stage mounts, so the View starts from the persisted view (no flash).
  const [ready, setReady] = useState(false);
  const hydrated = useRef(false);
  useLayoutEffect(() => {
    workspace.getState().setSurveys(data.surveys);
    if (!hydrated.current) {
      hydrated.current = true;
      workspace.getState().hydrate(data.persisted);
      setReady(true);
    }
  }, [workspace, data.surveys, data.persisted]);

  useUrlState(ready);
  usePersist(ready);

  const playing = useWorkspace((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const s = workspace.getState();
      if (!s.stepRight(1)) s.setPlaying(false);
    }, PLAY_STEP_MS);
    return () => clearInterval(id);
  }, [playing, workspace]);

  const { mode, l, r, blend, layerState, order, selection, initialView, viewApi } = useWorkspace(
    useShallow((s) => ({
      mode: s.mode,
      l: s.l,
      r: s.r,
      blend: s.blend,
      layerState: s.layerState,
      order: s.order,
      selection: s.selection,
      initialView: s.initialView,
      viewApi: s.viewApi,
    })),
  );
  const active = useTools((s) => s.active);
  const panHold = useTools((s) => s.panHold);

  const kinds = useRegistry(layerRegistry);
  const tools = useRegistry(toolRegistry);
  const rowsCtx = useMemo<LayerRowsContext>(
    () => ({ projectId, frame, layers: data.layers, surveys: data.surveys }),
    [projectId, frame, data.layers, data.surveys],
  );
  const rows = useMemo(() => kinds.flatMap((k) => k.rows(rowsCtx)), [kinds, rowsCtx]);
  const { placed, notInCompare } = useMemo(
    () =>
      placeLayers({
        rows,
        state: layerState,
        order,
        mode,
        l,
        r,
        blend,
        kinds: new Map(kinds.map((k) => [k.id, k])),
      }),
    [rows, layerState, order, mode, l, r, blend, kinds],
  );

  const inFrame = useMemo(() => data.layers.filter((layer) => layer.in_frame), [data.layers]);
  const siteExtent = useMemo(
    () =>
      unionExtent(
        inFrame.flatMap((layer) => (layer.footprint_site ? [layer.footprint_site as SiteExtent] : [])),
      ),
    [inFrame],
  );
  const onFit = useCallback(() => {
    if (siteExtent) workspace.getState().viewApi?.fit(siteExtent);
  }, [siteExtent, workspace]);

  // Fit the site once when there is no saved view and the link does not ask to centre somewhere.
  const fitted = useRef(false);
  useLayoutEffect(() => {
    if (fitted.current || !viewApi) return;
    fitted.current = true;
    if (workspace.getState().initialView) return;
    const req = arrivalRequest(new URLSearchParams(location.search));
    if (req.kind === "finding" || (req.kind === "map" && req.at)) return;
    onFit();
  }, [viewApi, workspace, location.search, onFit]);

  const [confirm, setConfirm] = useState<{
    sel: Selection;
    text: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const onDelete = useCallback(() => {
    const sel = workspace.getState().selection;
    const remove = sel ? inspectorRegistry.get(sel.kind)?.remove : undefined;
    if (sel && remove) setConfirm({ sel, text: remove.confirm(sel) });
  }, [workspace]);
  const runDelete = async () => {
    if (!confirm) return;
    const remove = inspectorRegistry.get(confirm.sel.kind)?.remove;
    if (!remove) return;
    setDeleting(true);
    try {
      await remove.run(confirm.sel, { api, projectId });
      workspace.getState().select(null);
      setConfirm(null);
    } catch (e) {
      toast("danger", messageOf(e, "Could not delete it."));
    } finally {
      setDeleting(false);
    }
  };

  useWorkspaceKeys({ onDelete, onFit });

  const activate = useTools((s) => s.activate);
  const commands = useMemo<Command[]>(
    () => [
      ...tools.map((t) => ({
        id: `maps.tool.${t.id}`,
        title: `${t.label} tool`,
        icon: t.icon,
        shortcut: shortcutFor(t.action),
        run: () => activate(t.id),
      })),
      {
        id: "maps.fit",
        title: "Fit the site",
        icon: "fit" as const,
        shortcut: "F",
        run: onFit,
      },
    ],
    [tools, activate, onFit],
  );
  useCommands(commands);

  const toolContext = useMemo(
    () => ({ frame, selection, surveys: data.surveys, layers: data.layers, r }),
    [frame, selection, data.surveys, data.layers, r],
  );
  const Overlay = tools.find((t) => t.id === active)?.Overlay;
  // Deviation 8: the r survey's ortho GSD (cm) is the 100 % zoom.
  const gsdCm = data.surveys.find((s) => s.date === r)?.maps.find((m) => m.gsd_cm !== null)?.gsd_cm ?? null;
  const nativeRes = gsdCm === null ? null : gsdCm / 100;

  return (
    <div
      data-testid="map-workspace"
      className={cx(
        "relative h-full w-full overflow-hidden bg-bg",
        active === "pan" || panHold ? "cursor-grab" : "cursor-crosshair",
      )}
    >
      {ready && (
        <SiteMap
          key={siteCode(frame)}
          frame={frame}
          mode={mode}
          placements={placed}
          initialView={initialView}
          projectId={projectId}
        />
      )}
      <PanelSlotHost slot="stage" projectId={projectId} frame={frame} />
      {Overlay && <Overlay projectId={projectId} frame={frame} />}
      {inFrame.length === 0 && <WorkspaceEmpty projectId={projectId} />}
      <ToolPalette context={toolContext} />
      <LayersPanel rows={rows} notInCompare={notInCompare} projectId={projectId} />
      <PanelSlotHost slot="top-center" projectId={projectId} frame={frame} />
      <ToolHint />
      <InspectorHost projectId={projectId} frame={frame} />
      <CoordinatesPanel projectId={projectId} />
      <PanelSlotHost slot="bottom-center" projectId={projectId} frame={frame} />
      <NavControls nativeRes={nativeRes} />
      <PanelSlotHost slot="bottom-right" projectId={projectId} frame={frame} />
      <Dialog
        open={confirm !== null}
        title="Delete?"
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={deleting} onClick={() => void runDelete()}>
              Delete
            </Button>
          </>
        }
      >
        {confirm?.text}
      </Dialog>
    </div>
  );
}
