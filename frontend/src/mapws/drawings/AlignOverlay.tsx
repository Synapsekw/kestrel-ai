import { useEffect, useRef } from "react";
import { useApi } from "@/api/client";
import { useTools, useWorkspace, useWorkspaceStores } from "@/mapws/context";
import type { ToolOverlayProps } from "@/mapws/tools/toolStore";
import { chordOf, isTypingTarget, toast } from "@/ui";
import { sessionFor, useAlignStore, viewportOf } from "../georef/alignStore";
import { formatMetres, georefErrorText } from "../georef/messages";
import { useDrawing } from "./drawingsStore";
import { saveAlignment } from "./saveAlignment";

export const ALIGN_TOOL_ID = "align-drawing";

/**
 * The K tool while active (spec §8.3): a click on the drawing, then the same point on the map.
 * PF9: W1 renders a tool's Overlay beside the map panes, not inside one, so this component has no
 * OL map. It starts the session, feeds W1's completed points to it, takes the keys and saves; the
 * session drawing's `DrawingMount` draws the marks on every map side (`useAlignMarks`).
 */
export function AlignOverlay({ projectId, frame }: ToolOverlayProps) {
  const api = useApi();
  const { workspace } = useWorkspaceStores();
  const selection = useWorkspace((s) => s.selection);
  const hasView = useWorkspace((s) => s.viewInfo !== null);
  const completed = useTools((s) => s.completed);
  const clearCompleted = useTools((s) => s.clearCompleted);
  const activate = useTools((s) => s.activate);
  const drawingId = selection?.kind === "drawing" ? selection.id : null;
  // Subscribed, so the session starts once the drawings list arrives.
  const drawing = useDrawing(projectId, drawingId ?? "");
  // Fills the stage (W1 renders the Overlay as a child of it): its size is the viewport in pixels.
  const stage = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  // The drawing this Overlay started a session for: a save or a discard ends it for good, not
  // until the list refreshes; selecting another drawing and coming back starts afresh.
  const startedFor = useRef<string | null>(null);

  // Start (or keep) the session of the selected drawing, provisionally at 60% of the view (PF17).
  useEffect(() => {
    const el = stage.current;
    if (!drawingId) startedFor.current = null;
    if (!drawingId || !drawing || drawing.status !== "ready" || !el || startedFor.current === drawingId)
      return;
    const ws = workspace.getState();
    if (!ws.viewInfo) return;
    startedFor.current = drawingId;
    // Switching tools keeps a session (R-W5-9): coming back to K resumes it.
    if (useAlignStore.getState().session?.drawingId === drawingId) return;
    // Side-by-side splits the stage between two maps that share one view.
    const width = ws.mode === "side" ? el.clientWidth / 2 : el.clientWidth;
    const r = sessionFor(drawing, viewportOf(ws.viewInfo, [width, el.clientHeight]), frame);
    useAlignStore.getState().begin(r.session, r.notice);
    // The marks and the preview are drawn by the row's Mount, which exists only while it is visible.
    const key = `drawing:${drawingId}`;
    if (ws.layerState[key]?.visible === false) ws.setLayerState(key, { visible: true });
  }, [workspace, drawingId, drawing, hasView, frame]);

  // W1's point draw spec turns each click into a completed Point: take it and clear it.
  useEffect(() => {
    if (!completed || completed.toolId !== ALIGN_TOOL_ID) return;
    const st = useAlignStore.getState();
    if (completed.geometry.type === "Point" && st.session && st.session.drawingId === drawingId) {
      const [x, y] = completed.geometry.coordinates;
      st.click([x, y]);
    }
    clearCompleted();
  }, [completed, clearCompleted, drawingId]);

  // R-W5-9: act before W1's key handling, only when there is something to act on.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || isTypingTarget(e.target)) return;
      const st = useAlignStore.getState();
      const chord = chordOf(e);
      let acted = false;
      if (chord === "Escape") acted = st.cancelPending();
      else if (chord === "Backspace" || chord === "Ctrl+Z") acted = st.undo();
      else if (chord === "Enter" && st.session?.fit?.ok) {
        acted = true;
        if (!saving.current) {
          saving.current = true;
          saveAlignment(api, projectId, st.session)
            .then((d) => {
              // Task 9 ruling: a save hands back to Select, so K is never left active and dead.
              activate("select");
              toast("ok", `Placement saved · RMSE ${formatMetres(d.georef?.rmse_m ?? 0)}`);
            })
            .catch((err: unknown) => toast("danger", georefErrorText(err)))
            .finally(() => {
              saving.current = false;
            });
        }
      }
      if (acted) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [api, projectId, activate]);

  return <div ref={stage} aria-hidden className="pointer-events-none absolute inset-0" />;
}
