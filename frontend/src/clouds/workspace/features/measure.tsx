import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "@/api/client";
import {
  createCloudMeasurement,
  getCloudProfile,
  retryCloudProfile,
  type CloudMeasurement,
  type CloudMeasurementCreate,
} from "@/api/cloudMeasurements";
import { messageOf } from "@/api/errors";
import type { CloudPick } from "@/clouds/CloudViewer";
import { isGeographic } from "@/clouds/measure";
import { MeasureHint } from "@/clouds/measuring/MeasureHint";
import { MeasureLabel } from "@/clouds/measuring/MeasureLabel";
import { MeasurementsTab } from "@/clouds/measuring/MeasurementsTab";
import {
  centroidOf,
  createBody,
  headline,
  labelAnchor,
  liveResult,
  measureKindOf,
  paramsOf,
  stateOf,
  toolShapes,
} from "@/clouds/measuring/measureView";
import { ProfilePanel, type ProfileStatus } from "@/clouds/measuring/ProfilePanel";
import type { ProfileData } from "@/clouds/measuring/profileView";
import {
  lineKey,
  previewSlab,
  profileData,
  slabBox,
  zRangeOf,
  type SectionLine,
} from "@/clouds/measuring/slab";
import { useCloudMeasurements } from "@/clouds/measuring/useCloudMeasurements";
import {
  DEFAULT_THICKNESS_M,
  INITIAL_TOOL,
  canCloseArea,
  cloudToolReducer,
  isComplete,
  isRings,
  nearVertex,
  useCloudTool,
  type CloudToolAction,
} from "@/clouds/useCloudTool";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";
import type { ClipBox } from "@/clouds/viewer/clipBox";
import { useJobsStore } from "@/store/jobs";
import { toast } from "@/ui";
import type { CloudToolId } from "../tools";
import type { FeatureContext, WorkspaceFeature, WorkspaceTool } from "../types";

/** C-M1's palette tools, in the mockup's order. */
const MEASURE_TOOLS: readonly CloudToolId[] = ["point", "distance", "height", "vertical", "area", "section"];
const OVERLAY_KEY = "measure";

function savedLine(m: CloudMeasurement | null): SectionLine | null {
  return m?.kind === "profile" && m.points.length === 2
    ? { a: m.points[0], b: m.points[1], thicknessM: m.params?.thickness_m ?? DEFAULT_THICKNESS_M }
    : null;
}

/**
 * The measure tools, the Measurements tab, the 3D label, the profile panel and the section line on
 * the minimap (C-M1, plan Rulings 1–16). The seams come from `ctx.seams`: this hook runs in
 * ReadyWorkspace above the seams provider.
 */
export function useMeasureFeature(ctx: FeatureContext): WorkspaceFeature {
  const { projectId, cloud, viewer, viewState, activeTool, seams, showTab, restoreClipBox } = ctx;
  const api = useApi();
  const tool = useCloudTool();
  const { state, dispatch } = tool;
  const kind = measureKindOf(activeTool);

  // Picks belong to one cloud's coordinates; the armed tool follows W1's (Ruling 2).
  const [toolCloud, setToolCloud] = useState(cloud.id);
  if (toolCloud !== cloud.id) {
    setToolCloud(cloud.id);
    dispatch({ type: "reset" });
  }
  if (state.kind !== kind) dispatch({ type: "arm", kind });

  const list = useCloudMeasurements(projectId, cloud.id);
  const geographic = isGeographic(cloud);
  const live = useMemo(() => liveResult(state, geographic), [state, geographic]);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const viewDir = useRef<[number, number, number] | null>(null);
  /** The line the latest preview request was for; answers for any other line are dropped. */
  const wantedPreview = useRef<string | null>(null);
  const [preview, setPreview] = useState<{ key: string; data: ProfileData } | null>(null);
  /** A ready row's stand-in preview when its stored profile cannot be read: its own slot, so it
   * never drops or replaces a draft line's preview (m5). */
  const [fallback, setFallback] = useState<{ key: string; data: ProfileData } | null>(null);
  const [full, setFull] = useState<{ key: string; data: ProfileData } | null>(null);

  const sel = list.selected;
  const draftLine = useMemo<SectionLine | null>(
    () =>
      state.kind === "profile" && isComplete(state)
        ? { a: state.picks[0], b: state.picks[1], thicknessM: state.thicknessM }
        : null,
    [state],
  );
  const line = draftLine ?? savedLine(sel);
  const key = line ? lineKey(line) : null;
  const boxJson = line ? JSON.stringify(slabBox(line, zRangeOf(cloud))) : null;

  // The camera direction at save orients an area's azimuth (C-B1 Ruling 3). Re-subscribed when the
  // view comes back (context loss, "Reload view").
  useEffect(() => {
    const v = viewer.current;
    if (!v || viewState !== "running") return;
    return v.onFrame((cam) => {
      viewDir.current = [cam.direction[0], cam.direction[1], cam.direction[2]];
    });
  }, [viewer, viewState, cloud.id]);

  // The overlay: the armed tool's picks while it has any, else the chosen measurement (Ruling 9). An
  // armed tool with no picks (after a Save, or while choosing rows) must not hide the chosen row.
  const selState = useMemo(() => (sel ? stateOf(sel) : null), [sel]);
  const drawing = state.picks.length > 0;
  const shapes = useMemo(
    () => (drawing ? toolShapes(state) : selState ? toolShapes(selState) : toolShapes(state)),
    [drawing, state, selState],
  );
  useEffect(() => {
    viewer.current?.setOverlay(OVERLAY_KEY, shapes);
  }, [viewer, shapes, viewState]);

  // The section slab as a highlighted clip box while a line is shown; W1 re-applies the operator's box.
  // Re-applied when the view (re)starts: W1 re-applies the operator's box after "Reload view".
  useEffect(() => {
    const v = viewer.current;
    if (!v || !boxJson || viewState !== "running") return;
    v.setClipBox(JSON.parse(boxJson) as ClipBox, "highlight_inside");
    return () => restoreClipBox();
  }, [viewer, boxJson, viewState, restoreClipBox]);

  // While C-R1 captures a view, V2's sampleSlab waits for it: a slow answer is pending, never a
  // failure (only a rejection toasts), and answers are keyed by the line they echo (hand-off f).
  // Plain functions where the viewer ref is read: the tools are rebuilt every render anyway.
  const sampleWith = useCallback((v: CloudViewerHandle, l: SectionLine) => {
    wantedPreview.current = lineKey(l);
    void previewSlab(v, l)
      .then((r) => {
        // A late answer for an earlier line must not drop the current line's preview.
        if (r.key === wantedPreview.current) setPreview(r);
      })
      .catch((e: unknown) => toast("danger", messageOf(e, "could not sample the section")));
  }, []);
  const samplePreview = (l: SectionLine) => {
    const v = viewer.current;
    if (v) sampleWith(v, l);
  };

  // The stored profile once its row is ready; keyed, so a late answer never paints another row.
  const selId = sel?.id ?? null;
  const readyKey =
    sel && sel.kind === "profile" && sel.status === "ready"
      ? `${cloud.id}|${sel.id}|${sel.updated_at}`
      : null;
  const selLine = savedLine(sel);
  const selLineJson = selLine ? JSON.stringify(selLine) : null;
  useEffect(() => {
    if (!readyKey || !selId) return;
    let current = true;
    getCloudProfile(api, projectId, cloud.id, selId)
      .then((p) => {
        if (current) setFull({ key: readyKey, data: profileData(p) });
      })
      .catch((e: unknown) => {
        if (!current) return;
        toast("danger", messageOf(e, "could not load the profile"));
        // Rather than an empty chart for good: the display points' preview of the same line.
        const v = viewer.current;
        if (!v || !selLineJson) return;
        void previewSlab(v, JSON.parse(selLineJson) as SectionLine)
          .then((r) => {
            if (current) setFallback(r);
          })
          .catch((err: unknown) => toast("danger", messageOf(err, "could not sample the section")));
      });
    return () => {
      current = false;
    };
  }, [api, projectId, cloud.id, selId, readyKey, selLineJson, viewer]);

  const persist = useCallback(
    async (body: CloudMeasurementCreate, { select = true }: { select?: boolean } = {}): Promise<boolean> => {
      if (inFlight.current) return false;
      inFlight.current = true;
      setSaving(true);
      let saved: CloudMeasurement;
      try {
        const r = await createCloudMeasurement(api, projectId, cloud.id, body);
        saved = r.measurement;
        list.upsert(r.measurement);
        if (r.job) useJobsStore.getState().upsert(r.job);
        if (select) list.select(r.measurement.id);
      } catch (e) {
        toast("danger", messageOf(e, "could not save the measurement"));
        return false;
      } finally {
        inFlight.current = false;
        setSaving(false);
      }
      // Outside the save's try: a failing capture must not read as a failed save (and keep the picks).
      try {
        seams.requestViewCapture({ kind: "cloud_measurement", id: saved.id }, "save");
      } catch (e) {
        toast("danger", messageOf(e, "could not capture the view of the measurement"));
      }
      return true;
    },
    [api, projectId, cloud.id, list, seams],
  );

  const save = useCallback(async () => {
    let s = state;
    if (canCloseArea(s)) {
      s = cloudToolReducer(s, { type: "close" });
      // An outline the server would refuse once closed (a bow-tie) stays open, so the next click
      // corrects it rather than starting a new outline.
      const why = liveResult(s, geographic).refusal;
      if (why) {
        toast("danger", why);
        return;
      }
      dispatch({ type: "close" });
    }
    if (!s.kind || !isComplete(s) || list.full || liveResult(s, geographic).refusal) return;
    if (await persist(createBody(s, viewDir.current))) dispatch({ type: "reset" });
  }, [state, dispatch, list.full, geographic, persist]);

  const onPick = (p: CloudPick) => {
    if (!state.kind) return;
    const v = viewer.current;
    const project = (q: { x: number; y: number; z: number }) => v?.project(q) ?? null;
    const onOutline =
      state.picks.length > 0 &&
      (nearVertex(project, state.picks[0], p) || nearVertex(project, state.picks[state.picks.length - 1], p));
    // The second click of a double-click that closed the outline lands on a vertex again: it is not
    // the first vertex of a new outline (Review Focus 1). A click elsewhere still starts one (Ruling 4).
    if (state.kind === "area" && state.closed && onOutline) return;
    const closes = canCloseArea(state) && onOutline;
    const action: CloudToolAction = { type: "pick", point: p, closes };
    const next = cloudToolReducer(state, action);
    dispatch(action);
    if (next.kind === "profile" && isComplete(next))
      samplePreview({ a: next.picks[0], b: next.picks[1], thicknessM: next.thicknessM });
  };

  const onHover = useCallback((p: CloudPick | null) => dispatch({ type: "hover", point: p }), [dispatch]);

  const onThickness = (thicknessM: number) => {
    dispatch({ type: "thickness", thicknessM });
    if (draftLine) samplePreview({ ...draftLine, thicknessM });
  };

  // Settles once the request does and never rejects (it toasts its own failure), so the Retry
  // buttons can stay disabled until then (M1 hand-off e).
  const retry = useCallback(
    (m: CloudMeasurement): Promise<void> =>
      retryCloudProfile(api, projectId, cloud.id, m.id)
        .then((job) => {
          useJobsStore.getState().upsert(job);
          list.upsert({ ...m, status: "computing", error: null, job_id: job.id });
        })
        .catch((e: unknown) => {
          toast("danger", messageOf(e, "could not retry the profile"));
        }),
    [api, projectId, cloud.id, list],
  );

  const choose = (m: CloudMeasurement) => {
    list.select(m.id);
    const v = viewer.current;
    if (v) {
      if (m.view) v.goToPose(m.view.pose);
      else v.lookAt(centroidOf(m.points), 30);
    }
    const l = savedLine(m);
    // A draft section line owns the panel and its preview; a chosen row does not take it over.
    if (l && m.status !== "ready" && !draftLine) samplePreview(l);
  };

  // The label follows the overlay's rule; memoised on the picks, not the hover, so it does not
  // re-subscribe to frames on every mouse move.
  const { kind: toolKind, method, picks } = state;
  const anchor = useMemo(
    () =>
      picks.length > 0
        ? labelAnchor({ ...INITIAL_TOOL, kind: toolKind, method, picks })
        : selState
          ? labelAnchor(selState)
          : null,
    [toolKind, method, picks, selState],
  );
  const labelText =
    drawing && state.kind && live.results
      ? headline(state.kind, paramsOf(state), live.results, state.picks)
      : !drawing && sel
        ? headline(sel.kind, sel.params, sel.results, sel.points)
        : null;
  const fullData = !draftLine && full && full.key === readyKey ? full.data : null;
  const previewData =
    preview && key && preview.key === key
      ? preview.data
      : fallback && key && fallback.key === key
        ? fallback.data
        : null;
  const status: ProfileStatus = draftLine ? "draft" : (sel?.status ?? "draft");
  const canCommit = (isComplete(state) || canCloseArea(state)) && !live.refusal && !list.full && !saving;

  const hint = state.kind ? (
    <MeasureHint tool={tool} live={live} full={list.full} onThickness={onThickness} />
  ) : undefined;
  const tools: WorkspaceTool[] = MEASURE_TOOLS.map((id) => ({
    id,
    picks: true,
    onArm: () => showTab("measurements"),
    onPick,
    onHover,
    hint: id === activeTool ? hint : undefined,
    onCommit: () => void save(),
    canCommit,
    commitLabel: "Save",
    onRemoveVertex: () => dispatch({ type: "backspace" }),
    onCancel: () => {
      if (state.picks.length === 0) return false;
      dispatch({ type: "reset" });
      return true;
    },
    onAction: (action) => {
      if (action !== "next-ring" || !isRings(state)) return false;
      dispatch({ type: "next-ring" });
      return true;
    },
  }));

  return {
    name: "measure",
    tools,
    measurementsTab: {
      body: (
        <MeasurementsTab projectId={projectId} cloud={cloud} list={list} onSelect={choose} onRetry={retry} />
      ),
      count: list.loaded ? list.items.length : null,
    },
    layer:
      labelText && anchor ? <MeasureLabel viewer={viewer} anchor={anchor} text={labelText} /> : undefined,
    floating:
      line && key ? (
        <ProfilePanel
          key={key}
          line={line}
          data={fullData ?? previewData}
          source={fullData ? "full" : "preview"}
          status={status}
          error={draftLine ? null : (sel?.error ?? null)}
          onRetry={!draftLine && sel?.status === "failed" ? () => retry(sel) : undefined}
          onSaveDistance={(a, b) =>
            // From a saved profile the new distance is not selected, so the panel stays on it.
            void persist({ kind: "distance", points: [a, b] }, { select: !!draftLine })
          }
        />
      ) : undefined,
    minimap: line ? [{ kind: "line", a: [line.a.x, line.a.y], b: [line.b.x, line.b.y] }] : undefined,
  };
}
