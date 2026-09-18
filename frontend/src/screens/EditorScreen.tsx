import { useEffect, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import type { KonvaEventObject } from "konva/lib/Node";
import { imageFileUrl, type Project } from "@contract/client";
import { useBackend } from "@/api/client";
import { useProject } from "@/api/project";
import { BoxLayer } from "@/editor/BoxLayer";
import { ClassSidebar } from "@/editor/ClassSidebar";
import { EditorCanvas } from "@/editor/EditorCanvas";
import { EditorToolbar } from "@/editor/EditorToolbar";
import {
  clampRect,
  displayMaxSide,
  isDrawable,
  normalizeRect,
  roundRect,
  toImage,
  type Point,
} from "@/editor/geometry";
import { RegionList } from "@/editor/RegionList";
import { useEditorActions } from "@/editor/useEditorActions";
import { useEditorHotkeys } from "@/editor/useEditorHotkeys";
import { useEditorImage } from "@/editor/useEditorImage";
import { useHistory } from "@/editor/useHistory";
import { useEditorStore, visibleBoxes } from "@/store/editor";

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
  const history = useHistory(imageId);
  const { actions, canUndo, canRedo } = useEditorActions(projectId, history);
  const drawStart = useRef<Point | null>(null);
  const visible = useMemo(() => visibleBoxes({ boxes, order, showRejected }), [boxes, order, showRejected]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const b of visible) c[b.class_id] = (c[b.class_id] ?? 0) + 1;
    return c;
  }, [visible]);
  useEditorHotkeys({ enabled: !loading, classes: project.classes, actions });

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
    drawStart.current = p;
    st.setDraft({ x: p.x, y: p.y, w: 0, h: 0, classId: st.activeClassId });
  };

  const onMouseMove = (e: KonvaEventObject<MouseEvent>) => {
    const start = drawStart.current;
    const st = useEditorStore.getState();
    const pos = e.target.getStage()?.getPointerPosition();
    if (!start || !pos || !st.image || !st.draft) return;
    st.setDraft({
      ...clampRect(normalizeRect(start, toImage(pos, st.view)), st.image),
      classId: st.draft.classId,
    });
  };

  const onMouseUp = () => {
    const start = drawStart.current;
    drawStart.current = null;
    const st = useEditorStore.getState();
    const draft = st.draft;
    st.setDraft(null);
    if (!start || !draft || !st.image) return;
    const rect = roundRect(clampRect(draft, st.image));
    if (isDrawable(rect)) void actions.drawBox(rect, draft.classId);
  };

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
          fileName={image?.file_name ?? (loading ? "Loading…" : "")}
          position={null}
          zoom={zoom}
          pending={pending}
          canUndo={canUndo}
          canRedo={canRedo}
          onPrev={() => {}}
          onNext={() => {}}
          onFit={fit}
          onOneToOne={oneToOne}
          onUndo={() => void actions.undo()}
          onRedo={() => void actions.redo()}
        />
        {error && (
          <p role="alert" className="border-b border-red-900 bg-red-950 px-3 py-1 text-xs text-red-200">
            {error}
          </p>
        )}
        {notice && (
          <p
            role="status"
            className="border-b border-slate-800 bg-slate-900 px-3 py-1 text-xs text-slate-300"
          >
            {notice}
          </p>
        )}
        <div className="min-h-0 flex-1">
          <EditorCanvas
            src={src}
            onBackgroundMouseDown={onBackgroundMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
          >
            <BoxLayer
              classes={project.classes}
              onCommitRect={(id, before, after) => void actions.commitRect(id, before, after)}
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
