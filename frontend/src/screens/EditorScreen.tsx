import { useEffect, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import type { KonvaEventObject } from "konva/lib/Node";
import { imageFileUrl, type Project } from "@contract/client";
import { useBackend } from "@/api/client";
import { pushLog } from "@/app/diagnostics";
import { useProject } from "@/api/project";
import { BoxLayer } from "@/editor/BoxLayer";
import { ClassSidebar } from "@/editor/ClassSidebar";
import { EditorCanvas } from "@/editor/EditorCanvas";
import { BackLink } from "@/editor/BackLink";
import { ConfidenceFloor } from "@/editor/ConfidenceFloor";
import { EditorToolbar } from "@/editor/EditorToolbar";
import { EmptyToggle } from "@/editor/EmptyToggle";
import { clampRect, displayMaxSide, dragRect, normalizeRect, toImage, type Point } from "@/editor/geometry";
import { RegionList } from "@/editor/RegionList";
import { useEditorActions } from "@/editor/useEditorActions";
import { useEditorHotkeys } from "@/editor/useEditorHotkeys";
import { useEditorImage } from "@/editor/useEditorImage";
import { useEditorNavigation } from "@/editor/useEditorNavigation";
import { useHistory } from "@/editor/useHistory";
import { hasGroundTruth, useEditorStore, visibleBoxes, visibleProposalIds } from "@/store/editor";

export function EditorScreen() {
  const { projectId = "", imageId = "" } = useParams();
  const { project, error: projectError } = useProject(projectId);
  if (projectError) {
    return (
      <p role="alert" className="m-6 rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
        {projectError}
      </p>
    );
  }
  if (!project) return <p className="m-6 text-sm text-slate-400">Loading project…</p>;
  return <EditorBody projectId={projectId} imageId={imageId} project={project} />;
}

function EditorBody({
  projectId,
  imageId,
  project,
}: {
  projectId: string;
  imageId: string;
  project: Project;
}) {
  const { baseUrl, token } = useBackend();
  const { loading } = useEditorImage(projectId, imageId, project.preannotation_model_id);
  const image = useEditorStore((s) => s.image);
  const error = useEditorStore((s) => s.error);
  const notice = useEditorStore((s) => s.notice);
  const activeClassId = useEditorStore((s) => s.activeClassId);
  const setActiveClass = useEditorStore((s) => s.setActiveClass);
  const boxes = useEditorStore((s) => s.boxes);
  const order = useEditorStore((s) => s.order);
  const showRejected = useEditorStore((s) => s.showRejected);
  const selectedId = useEditorStore((s) => s.selectedId);
  const hoveredId = useEditorStore((s) => s.hoveredId);
  const zoom = useEditorStore((s) => s.view.scale);
  const pending = useEditorStore((s) => s.pending);
  const select = useEditorStore((s) => s.select);
  const hover = useEditorStore((s) => s.hover);
  const fit = useEditorStore((s) => s.fit);
  const oneToOne = useEditorStore((s) => s.oneToOne);
  const toggleShowRejected = useEditorStore((s) => s.toggleShowRejected);
  const history = useHistory(imageId);
  const { actions, canUndo, canRedo } = useEditorActions(projectId, history);
  // The anchor is an image pixel (a zoom or pan mid-drag leaves it put); start/end are display
  // points so `dragRect` can tell a click from a drag on mouse up.
  const drawAnchor = useRef<Point | null>(null);
  const drawStart = useRef<Point | null>(null);
  const drawEnd = useRef<Point | null>(null);
  const minConfidence = useEditorStore((s) => s.minConfidence);
  const setMinConfidence = useEditorStore((s) => s.setMinConfidence);
  const visible = useMemo(
    () => visibleBoxes({ boxes, order, showRejected, minConfidence }),
    [boxes, order, showRejected, minConfidence],
  );
  // Proposals the confidence floor keeps out of sight on this image.
  const hiddenByFloor = useMemo(
    () =>
      visibleProposalIds({ boxes, order, showRejected }).length -
      visibleProposalIds({ boxes, order, showRejected, minConfidence }).length,
    [boxes, order, showRejected, minConfidence],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const b of visible) c[b.class_id] = (c[b.class_id] ?? 0) + 1;
    return c;
  }, [visible]);
  const proposalIds = useMemo(
    () => visibleProposalIds({ boxes, order, showRejected, minConfidence }),
    [boxes, order, showRejected, minConfidence],
  );
  const groundTruth = useMemo(() => hasGroundTruth(boxes), [boxes]);
  const navigation = useEditorNavigation(projectId, imageId);
  const nav = useMemo(
    () => ({ next: navigation.next, prev: navigation.prev }),
    [navigation.next, navigation.prev],
  );
  useEditorHotkeys({ enabled: !loading, classes: project.classes, actions, nav });

  // A zustand action, not a React state setter: the compiler rule `set-state-in-effect` does not apply.
  useEffect(() => {
    if (!activeClassId || !project.classes.some((c) => c.id === activeClassId)) {
      setActiveClass(project.classes[0]?.id ?? null);
    }
  }, [activeClassId, project.classes, setActiveClass]);

  const src = useMemo(
    () => (image ? imageFileUrl(baseUrl, token, projectId, image.id, displayMaxSide(image)) : null),
    [baseUrl, token, projectId, image],
  );

  const onBackgroundMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return;
    const st = useEditorStore.getState();
    const pos = e.target.getStage()?.getPointerPosition();
    if (!pos) return;
    if (!st.activeClassId) {
      st.setNotice("Pick a class first (keys 1 to 9)");
      return;
    }
    st.select(null);
    const p = toImage(pos, st.view);
    drawAnchor.current = p;
    drawStart.current = pos;
    drawEnd.current = pos;
    st.setDraft({ x: p.x, y: p.y, w: 0, h: 0, classId: st.activeClassId });
  };

  const onMouseMove = (e: KonvaEventObject<MouseEvent>) => {
    const anchor = drawAnchor.current;
    const st = useEditorStore.getState();
    const pos = e.target.getStage()?.getPointerPosition();
    if (!anchor || !pos || !st.image || !st.draft) return;
    drawEnd.current = pos;
    // Visual feedback only; the box itself is decided on mouse up.
    st.setDraft({
      ...clampRect(normalizeRect(anchor, toImage(pos, st.view)), st.image),
      classId: st.draft.classId,
    });
  };

  const onMouseUp = () => {
    const anchor = drawAnchor.current;
    const start = drawStart.current;
    const end = drawEnd.current;
    drawAnchor.current = null;
    drawStart.current = null;
    drawEnd.current = null;
    const st = useEditorStore.getState();
    const draft = st.draft;
    st.setDraft(null);
    if (!anchor || !start || !end || !draft || !st.image) return;
    const rect = dragRect(anchor, start, end, st.view, st.image);
    if (rect)
      void actions
        .drawBox(rect, draft.classId)
        .catch((err: unknown) => pushLog(`draw box failed: ${String(err)}`));
  };

  const reviewControls = (
    <>
      <span className="mx-1 h-4 border-l border-slate-700" />
      <span className="text-xs text-slate-400" data-testid="proposal-count">
        {proposalIds.length} {proposalIds.length === 1 ? "proposal" : "proposals"}
      </span>
      <button
        type="button"
        className="rounded border border-emerald-800 px-2 py-0.5 text-xs text-emerald-200 hover:bg-emerald-900/40 disabled:opacity-40"
        disabled={proposalIds.length === 0}
        onClick={() => void actions.acceptAll()}
      >
        Accept all (A)
      </button>
      <button
        type="button"
        className="rounded border border-amber-800 px-2 py-0.5 text-xs text-amber-200 hover:bg-amber-900/40 disabled:opacity-40"
        disabled={proposalIds.length === 0}
        onClick={() => void actions.rejectAll()}
      >
        Reject all (R)
      </button>
      <button
        type="button"
        aria-pressed={showRejected}
        className={`rounded border border-slate-700 px-2 py-0.5 text-xs ${showRejected ? "bg-slate-700 text-white" : "hover:bg-slate-800"}`}
        onClick={toggleShowRejected}
      >
        Show rejected
      </button>
      {(proposalIds.length > 0 || hiddenByFloor > 0 || minConfidence > 0) && (
        <ConfidenceFloor value={minConfidence} hidden={hiddenByFloor} onChange={setMinConfidence} />
      )}
      <span className="mx-1 h-4 border-l border-slate-700" />
      <EmptyToggle
        image={image}
        hasGroundTruth={groundTruth}
        busy={pending > 0}
        onToggle={() => void actions.toggleEmpty()}
      />
    </>
  );

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-48 shrink-0 flex-col border-r border-slate-800 bg-slate-950 p-2">
        <ClassSidebar
          classes={project.classes}
          activeClassId={activeClassId}
          counts={counts}
          onSelect={setActiveClass}
        />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <EditorToolbar
          lead={<BackLink projectId={projectId} />}
          fileName={image?.file_name ?? (loading ? "Loading…" : "")}
          position={navigation.position}
          zoom={zoom}
          pending={pending}
          canUndo={canUndo}
          canRedo={canRedo}
          onPrev={navigation.prev}
          onNext={navigation.next}
          onFit={fit}
          onOneToOne={oneToOne}
          onUndo={() => void actions.undo()}
          onRedo={() => void actions.redo()}
          extra={reviewControls}
        />
        {error && (
          <p role="alert" className="border-b border-red-900 bg-red-950 px-3 py-1 text-xs text-red-200">
            {error}
          </p>
        )}
        <div className="relative min-h-0 flex-1">
          {/* Overlaid, so the image does not jump when a notice comes or goes. */}
          {notice && (
            <p
              role="status"
              className="absolute inset-x-0 top-0 z-10 border-b border-slate-800 bg-slate-900/90 px-3 py-1 text-xs text-slate-300"
            >
              {notice}
            </p>
          )}
          <EditorCanvas
            src={src}
            onBackgroundMouseDown={onBackgroundMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
          >
            <BoxLayer
              classes={project.classes}
              onCommitRect={(id, before, after) => actions.commitRect(id, before, after)}
            />
          </EditorCanvas>
        </div>
      </div>
      <aside className="flex w-72 shrink-0 flex-col border-l border-slate-800 bg-slate-950">
        <RegionList
          boxes={visible}
          classes={project.classes}
          selectedId={selectedId}
          hoveredId={hoveredId}
          markedEmpty={image?.marked_empty ?? false}
          onSelect={select}
          onHover={hover}
          onSetClass={(id, classId) => void actions.setClass(id, classId)}
          onDelete={(id) => void actions.deleteBox(id)}
          onReview={(id, action) => void actions.review([id], action)}
        />
      </aside>
    </div>
  );
}
