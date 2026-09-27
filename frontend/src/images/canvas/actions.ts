import { fetchFinding, type FindingDetail } from "@/api/findings";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { selectedShapes, singleSelected } from "@/store/imagesWorkspace";
import {
  cmdDeleteMeasurement,
  cmdDeleteShapes,
  cmdDuplicate,
  cmdSetType,
  cmdUpdateShape,
  type CommandContext,
} from "./commands";
import { clampOriented, clampPoint, orientedRectOf, toPoints, translatePoints } from "./geometry";

export { FINDING_HAS_CONTENT_MESSAGE } from "./commands";

/** Ruling FC-R4: a note, a photo or a comment makes a finding worth a confirmation. */
export function findingHasContent(
  f: Pick<FindingDetail, "note" | "attachment_count" | "comment_count">,
): boolean {
  return f.note.trim() !== "" || f.attachment_count > 0 || f.comment_count > 0;
}

/** Del: a selected measurement, or the selected shapes (confirming when a finding has content). */
export async function deleteSelection(ctx: CommandContext): Promise<void> {
  const s = ctx.store.getState();
  if (s.selectedMeasurementId) return cmdDeleteMeasurement(ctx, s.selectedMeasurementId);
  const shapes = selectedShapes(s);
  if (shapes.length === 0) return;
  const linked = shapes.map((b) => s.findingOf[b.id]).filter((f): f is string => !!f);
  let touched: FindingDetail[];
  try {
    const found = await Promise.all(linked.map((fid) => fetchFinding(ctx.api, ctx.projectId, fid)));
    touched = found.filter(findingHasContent);
  } catch (e) {
    // A finding we cannot read is treated as having content: ask rather than lose a note silently.
    pushLog(`read finding before delete failed: ${messageOf(e, String(e))}`);
    ctx.store.getState().setConfirm({ kind: "delete", ids: shapes.map((b) => b.id), findings: [] });
    return;
  }
  if (touched.length) {
    ctx.store.getState().setConfirm({ kind: "delete", ids: shapes.map((b) => b.id), findings: touched });
    return;
  }
  await cmdDeleteShapes(
    ctx,
    shapes.map((b) => b.id),
  );
}

export async function confirmDelete(ctx: CommandContext): Promise<void> {
  const c = ctx.store.getState().confirm;
  if (c?.kind !== "delete") return;
  ctx.store.getState().setConfirm(null);
  await cmdDeleteShapes(ctx, c.ids);
}

/** T with a selection: retype every selected shape; a defect → object change asks first (FC-R5). */
export async function retypeSelection(ctx: CommandContext, typeId: string): Promise<void> {
  const ids = ctx.store.getState().selectedIds;
  if (ids.length === 0) return;
  const outcome = await cmdSetType(ctx, ids, typeId);
  if (outcome === "needs-confirm") ctx.store.getState().setConfirm({ kind: "retype", ids, typeId });
}

export async function confirmRetype(ctx: CommandContext): Promise<void> {
  const c = ctx.store.getState().confirm;
  if (c?.kind !== "retype") return;
  ctx.store.getState().setConfirm(null);
  await cmdSetType(ctx, c.ids, c.typeId, { confirmFindingDelete: true });
}

export async function duplicateSelection(ctx: CommandContext): Promise<void> {
  await cmdDuplicate(ctx, ctx.store.getState().selectedIds);
}

/** Alt+arrows: 1 px, with Shift 10 px (the caller passes the step). One shape only (FC-R7). */
export async function nudgeSelection(ctx: CommandContext, dx: number, dy: number): Promise<void> {
  const s = ctx.store.getState();
  const box = singleSelected(s);
  if (!box || !s.image) return;
  if (box.shape === "polygon") {
    return cmdUpdateShape(ctx, box.id, {
      kind: "points",
      points: translatePoints(toPoints(box.points ?? []), dx, dy),
    });
  }
  if (box.shape === "point") {
    return cmdUpdateShape(ctx, box.id, {
      kind: "point",
      at: clampPoint({ x: box.x + dx, y: box.y + dy }, s.image),
    });
  }
  const r = orientedRectOf(box);
  return cmdUpdateShape(ctx, box.id, {
    kind: "rect",
    rect: clampOriented({ ...r, x: r.x + dx, y: r.y + dy }, s.image),
  });
}

/** Shift+← / Shift+→: rotate a box or rbox by `deltaDeg` (1°). */
export async function rotateSelection(ctx: CommandContext, deltaDeg: number): Promise<void> {
  const s = ctx.store.getState();
  const box = singleSelected(s);
  if (!box || !s.image || (box.shape !== "box" && box.shape !== "rbox")) return;
  const r = orientedRectOf(box);
  return cmdUpdateShape(ctx, box.id, {
    kind: "rect",
    rect: clampOriented({ ...r, angle: r.angle + deltaDeg }, s.image),
  });
}
