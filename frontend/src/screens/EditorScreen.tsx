import { useEffect, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import type { KonvaEventObject } from "konva/lib/Node";
import { imageFileUrl, type Project } from "@contract/client";
import { useBackend } from "@/api/client";
import { pushLog } from "@/app/diagnostics";
import { useProject } from "@/api/project";
import { BoxLayer } from "@/editor/BoxLayer";
import { EditorInspector } from "@/editor/EditorInspector";
import { EditorCanvas } from "@/editor/EditorCanvas";
import { BackLink } from "@/editor/BackLink";
import { ConfidenceFloor } from "@/editor/ConfidenceFloor";
import { EditorToolbar } from "@/editor/EditorToolbar";
import { EmptyToggle } from "@/editor/EmptyToggle";
import { clampRect, displayMaxSide, dragRect, normalizeRect, toImage, type Point } from "@/editor/geometry";
import { useEditorActions } from "@/editor/useEditorActions";
import { useEditorHotkeys } from "@/editor/useEditorHotkeys";
import { useEditorImage } from "@/editor/useEditorImage";
import { useEditorNavigation } from "@/editor/useEditorNavigation";
import { useHistory } from "@/editor/useHistory";
import {
  hasGroundTruth,
  hiddenProposalCount,
  useEditorStore,
  visibleBoxes,
  visibleProposalIds,
} from "@/store/editor";
import { Alert, Button, Pill, Skeleton, Switch } from "@/ui";

export function EditorScreen() {
  const { projectId = "", imageId = "" } = useParams();
  const { project, error: projectError } = useProject(projectId);
  if (projectError) {
    return (
      <div className="p-6">
        <Alert tone="danger" className="max-w-2xl">
          {projectError}
        </Alert>
      </div>
    );
  }
  if (!project) return <EditorSkeleton />;
  return <EditorBody projectId={projectId} imageId={imageId} project={project} />;
}

/** Loading keeps the same canvas and single-inspector geometry as the ready editor. */
function EditorSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading project"
      className="flex h-full min-h-0 flex-col overflow-auto md:flex-row"
    >
      <div className="flex min-h-[360px] min-w-0 flex-1 flex-col md:min-h-0">
        <div className="flex h-[100px] shrink-0 flex-col justify-center gap-3 border-b border-line bg-bg px-3">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="min-h-0 flex-1 bg-bg" />
      </div>
      <div className="flex w-full shrink-0 flex-col gap-2 border-t border-line bg-surface p-4 md:w-[310px] md:border-l md:border-t-0">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-7 w-full" />
        <Skeleton className="h-7 w-full" />
      </div>
    </div>
  );
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
    () => hiddenProposalCount({ boxes, order, showRejected, minConfidence }),
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
      <Pill tone={proposalIds.length > 0 ? "warn" : "neutral"} data-testid="proposal-count">
        {proposalIds.length} {proposalIds.length === 1 ? "suggestion" : "suggestions"}
      </Pill>
      <Button
        variant="primary"
        size="sm"
        disabled={proposalIds.length === 0}
        onClick={() => void actions.acceptAll()}
      >
        Accept all (A)
      </Button>
      <Button size="sm" disabled={proposalIds.length === 0} onClick={() => void actions.rejectAll()}>
        Reject all (R)
      </Button>
      <Switch
        checked={showRejected}
        onChange={toggleShowRejected}
        label="Show rejected"
        className="px-1 !text-[13px]"
      />
      {(proposalIds.length > 0 || hiddenByFloor > 0 || minConfidence > 0) && (
        <ConfidenceFloor value={minConfidence} hidden={hiddenByFloor} onChange={setMinConfidence} />
      )}
      <EmptyToggle
        image={image}
        hasGroundTruth={groundTruth}
        busy={pending > 0}
        onToggle={() => void actions.toggleEmpty()}
      />
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto md:flex-row md:overflow-hidden">
      <div className="flex min-h-[360px] min-w-0 flex-1 flex-col md:min-h-0">
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
        />
        {/* Errors and notices often follow a hotkey: they appear without the reveal animation. */}
        {error && (
          <Alert tone="danger" className="rounded-none border-x-0 border-t-0 py-2 !text-[13px] !animate-none">
            {error}
          </Alert>
        )}
        <div className="relative min-h-0 flex-1 bg-bg">
          {/* Overlaid, so the image does not jump when a notice comes or goes. */}
          {notice && (
            <Alert
              tone="info"
              role="status"
              className="absolute inset-x-3 top-3 z-10 py-2 !text-[13px] shadow-float !animate-none"
            >
              {notice}
            </Alert>
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
      <EditorInspector
        classes={project.classes}
        activeClassId={activeClassId}
        counts={counts}
        onSelect={setActiveClass}
        reviewControls={reviewControls}
        regions={{
          boxes: visible,
          classes: project.classes,
          selectedId,
          hoveredId,
          markedEmpty: image?.marked_empty ?? false,
          hiddenByFloor,
          onSelect: select,
          onHover: hover,
          onSetClass: (id, classId) => void actions.setClass(id, classId),
          onDelete: (id) => void actions.deleteBox(id),
          onReview: (id, action) => void actions.review([id], action),
        }}
      />
    </div>
  );
}
