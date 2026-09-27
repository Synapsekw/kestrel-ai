import { useMemo } from "react";
import type { ApiClient, Box, BoxCreate, BoxUpdate } from "@contract/client";
import { deleteBox } from "@/api/boxes";
import { useApi } from "@/api/client";
import { ApiFailure, codeOf, messageOf } from "@/api/errors";
import { fetchFinding, type FindingDetail } from "@/api/findings";
import {
  bodyOf,
  createImageMeasurement,
  createShape,
  deleteImageMeasurement,
  reviewShapes,
  updateShape,
  type BoxReviewResult,
  type BoxWriteResult,
  type ImageMeasurement,
} from "@/api/shapes";
import { pushLog } from "@/app/diagnostics";
import { useImagesWorkspace, type ImagesWorkspaceStore } from "@/store/imagesWorkspace";
import { toast } from "@/ui/toastStore";
import {
  fromPoints,
  orientedEquals,
  orientedRectOf,
  roundOriented,
  type OrientedRect,
  type Point,
} from "./geometry";
import type { BoxRef, History } from "./history";

export interface CommandContext {
  api: ApiClient;
  projectId: string;
  store: ImagesWorkspaceStore;
  history: History;
}

/** The context for the image loaded now; a new image brings a new History (store.loadImage). */
export function useCommandContext(projectId: string): CommandContext {
  const api = useApi();
  const history = useImagesWorkspace((s) => s.history);
  return useMemo(() => ({ api, projectId, store: useImagesWorkspace, history }), [api, projectId, history]);
}

export type ShapePatch =
  { kind: "rect"; rect: OrientedRect } | { kind: "points"; points: Point[] } | { kind: "point"; at: Point };

/** Spec §16's wording for an undo refused because the finding already has content. */
export const FINDING_HAS_CONTENT_MESSAGE = "This finding has a note or photos; delete it from the inspector.";

/**
 * Queues a whole command behind the earlier ones of the same image, so history order equals action
 * order and each command reads the state the previous one left. Every exported `cmd*` runs its
 * body (state reads included) through this; a body must never await another `enqueue` (the queue
 * would wait on itself), so bodies call the `*Now` functions and undo/redo call the API directly.
 */
export function enqueue<T>(ctx: CommandContext, fn: () => Promise<T>): Promise<T> {
  ctx.store.getState().beginRequest();
  return ctx.history.run(fn).finally(() => ctx.store.getState().endRequest());
}

/** Ruling FC-R4: a note, a photo or a comment makes a finding worth a confirmation. */
export function findingHasContent(
  f: Pick<FindingDetail, "note" | "attachment_count" | "comment_count">,
): boolean {
  return f.note.trim() !== "" || f.attachment_count > 0 || f.comment_count > 0;
}

/**
 * An undo that would delete the finding linked to `boxId` refuses when that finding has content
 * (spec section 16): it throws `finding_has_content`, so `tracked` shows FINDING_HAS_CONTENT_MESSAGE
 * and the history entry stays on the stack.
 */
async function refuseIfFindingHasContent(ctx: CommandContext, boxId: string): Promise<void> {
  const findingId = ctx.store.getState().findingOf[boxId];
  if (!findingId) return;
  const finding = await fetchFinding(ctx.api, ctx.projectId, findingId);
  if (findingHasContent(finding))
    throw new ApiFailure("finding_has_content", FINDING_HAS_CONTENT_MESSAGE, 409);
}

/** A write result's finding link, or none: F links a defect's finding and drops an object's. */
function syncFindingLink(ctx: CommandContext, written: BoxWriteResult): void {
  const s = ctx.store.getState();
  if (written.finding_id) s.linkFindings({ [written.id]: written.finding_id });
  else s.unlinkFinding(written.id);
}

function failureText(label: string, e: unknown): string {
  if (codeOf(e) === "finding_has_content") return FINDING_HAS_CONTENT_MESSAGE;
  return `${label} failed: ${messageOf(e, "unknown error")}`;
}

/**
 * One API interaction with the pending counter and error capture; resolves `undefined` on failure
 * and records `failure` with `retry` (spec §6.4 "Save failed · Retry", ruling FC-R15).
 */
export async function tracked<T>(
  ctx: CommandContext,
  label: string,
  fn: () => Promise<T>,
  retry?: () => void,
): Promise<T | undefined> {
  const s = ctx.store.getState();
  s.beginRequest();
  s.clearFailure();
  try {
    return await fn();
  } catch (e) {
    pushLog(`${label} failed: ${messageOf(e, String(e))}`);
    ctx.store.getState().fail(failureText(label, e), retry);
    return undefined;
  } finally {
    ctx.store.getState().endRequest();
  }
}

function isProposal(box: Box): boolean {
  return box.provenance.kind !== "person";
}

/** F17: the one place that shows the "geometry was repaired" toast (create and update alike). */
function toastIfRepaired(written: BoxWriteResult): void {
  if (written.repaired) toast("info", "The outline crossed itself or left the frame, so it was repaired.");
}

function afterCreate(ctx: CommandContext, created: BoxWriteResult): void {
  const s = ctx.store.getState();
  s.upsertBox(created);
  if (created.finding_id) s.linkFindings({ [created.id]: created.finding_id });
  s.select([created.id]);
  toastIfRepaired(created);
}

export function cmdCreateShape(
  ctx: CommandContext,
  imageId: string,
  body: BoxCreate,
): Promise<BoxWriteResult | undefined> {
  return enqueue(ctx, () => createShapeNow(ctx, imageId, body));
}

async function createShapeNow(
  ctx: CommandContext,
  imageId: string,
  body: BoxCreate,
): Promise<BoxWriteResult | undefined> {
  const { api, projectId, store, history } = ctx;
  const run = () => createShape(api, projectId, imageId, body);
  const retry = () => void tracked(ctx, "draw shape", run).then((b) => b && afterCreate(ctx, b));
  const created = await tracked(ctx, "draw shape", run, retry);
  if (!created) return undefined;
  afterCreate(ctx, created);
  const ref: BoxRef = { id: created.id };
  history.push({
    label: "draw shape",
    undo: async () => {
      await refuseIfFindingHasContent(ctx, ref.id); // I4: deleting the shape deletes its finding.
      await deleteBox(api, projectId, ref.id);
      store.getState().removeBox(ref.id);
      store.getState().unlinkFinding(ref.id);
    },
    redo: async () => {
      const again = await createShape(api, projectId, imageId, body);
      history.alias(ref.id, again.id);
      ref.id = again.id;
      afterCreate(ctx, again);
    },
  });
  return created;
}

function patchBody(patch: ShapePatch): BoxUpdate {
  if (patch.kind === "points") return { points: fromPoints(patch.points) };
  if (patch.kind === "point")
    return { x: Math.round(patch.at.x * 10) / 10, y: Math.round(patch.at.y * 10) / 10 };
  const r = roundOriented(patch.rect);
  return { x: r.x, y: r.y, w: r.w, h: r.h, angle: r.angle };
}

function patchOf(box: Box): ShapePatch {
  if (box.shape === "polygon")
    return { kind: "points", points: (box.points ?? []).map(([x, y]) => ({ x, y })) };
  if (box.shape === "point") return { kind: "point", at: { x: box.x, y: box.y } };
  return { kind: "rect", rect: orientedRectOf(box) };
}

function samePatch(a: ShapePatch, b: ShapePatch): boolean {
  if (a.kind === "rect" && b.kind === "rect") return orientedEquals(a.rect, b.rect);
  return JSON.stringify(patchBody(a)) === JSON.stringify(patchBody(b));
}

/**
 * Move/resize/rotate a box or rbox, move a point, or replace a polygon's points (R-BA6). `after`
 * may be a function of the box as it stands when the command runs (after every earlier queued
 * command), so relative edits such as a nudge compose instead of reading a stale box.
 */
export function cmdUpdateShape(
  ctx: CommandContext,
  id: string,
  after: ShapePatch | ((box: Box) => ShapePatch | null),
): Promise<void> {
  return enqueue(ctx, () => updateShapeNow(ctx, id, after));
}

async function updateShapeNow(
  ctx: CommandContext,
  id: string,
  next: ShapePatch | ((box: Box) => ShapePatch | null),
): Promise<void> {
  const { api, projectId, store, history } = ctx;
  const box = store.getState().boxes[id];
  if (!box) return;
  const after = typeof next === "function" ? next(box) : next;
  if (!after) return;
  const before = patchOf(box);
  if (samePatch(before, after)) return;
  const restoreProposal = isProposal(box) && box.review_state === "unreviewed";
  const run = () => updateShape(api, projectId, id, patchBody(after));
  const updated = await tracked(
    ctx,
    "edit shape",
    run,
    () => void tracked(ctx, "edit shape", run).then((b) => b && store.getState().upsertBox(b)),
  );
  if (!updated) return;
  store.getState().upsertBox(updated);
  toastIfRepaired(updated);
  history.push({
    label: "edit shape",
    undo: async () => {
      const current = history.resolve(id);
      store.getState().upsertBox(await updateShape(api, projectId, current, patchBody(before)));
      if (restoreProposal) {
        await reviewShapes(api, projectId, [current], "unreview");
        store.getState().patchStates([current], "unreviewed");
      }
    },
    redo: async () =>
      store.getState().upsertBox(await updateShape(api, projectId, history.resolve(id), patchBody(after))),
  });
}

/**
 * Retype one or more shapes. `needs-confirm` when F refuses a defect → object change that would
 * delete a finding (409 finding_would_be_deleted); the caller confirms and calls again with
 * `confirmFindingDelete` (ruling FC-R5). Undo retypes back with confirm (FC-R3).
 *
 * I2: ids are retyped one at a time in order; if a later one is refused (or fails outright), the
 * ids already retyped on the server stay retyped — so a history entry covering just *those* is
 * pushed before returning "needs-confirm"/"failed", or every target's history entry pushed
 * before returning "done". The confirm retry calls this again with the full original selection;
 * ids already at `typeId` are filtered out of `targets`, so only the unfinished ones are retried.
 */
export function cmdSetType(
  ctx: CommandContext,
  ids: string[],
  typeId: string,
  opts: { confirmFindingDelete?: boolean } = {},
): Promise<"done" | "needs-confirm" | "failed"> {
  return enqueue(ctx, () => setTypeNow(ctx, ids, typeId, opts));
}

async function setTypeNow(
  ctx: CommandContext,
  ids: string[],
  typeId: string,
  opts: { confirmFindingDelete?: boolean },
): Promise<"done" | "needs-confirm" | "failed"> {
  const { api, projectId, store, history } = ctx;
  const retype = async (id: string, classId: string, o: { confirmFindingDelete?: boolean }) => {
    const written = await updateShape(api, projectId, id, { class_id: classId }, o);
    store.getState().upsertBox(written);
    syncFindingLink(ctx, written); // I3: object -> defect links a finding, defect -> object drops it.
  };
  const targets = ids
    .map((id) => store.getState().boxes[id])
    .filter((b): b is Box => !!b && b.class_id !== typeId);
  if (targets.length === 0) return "done";
  const previous = new Map(targets.map((b) => [b.id, b.class_id]));
  const applied: string[] = [];
  let outcome: "done" | "needs-confirm" | "failed" = "done";
  store.getState().beginRequest();
  store.getState().clearFailure();
  try {
    for (const b of targets) {
      await retype(b.id, typeId, opts);
      applied.push(b.id);
    }
  } catch (e) {
    if (e instanceof ApiFailure && e.code === "finding_would_be_deleted") {
      outcome = "needs-confirm";
    } else {
      pushLog(`change type failed: ${messageOf(e, String(e))}`);
      store.getState().fail(failureText("change type", e));
      outcome = "failed";
    }
  } finally {
    store.getState().endRequest();
  }
  if (applied.length > 0) {
    const appliedPrevious = new Map(applied.map((id) => [id, previous.get(id)!]));
    history.push({
      label: "change type",
      undo: async () => {
        // I4: going back to an object type deletes the finding the retype created; refuse when
        // it has content by now (every id is checked first, so nothing is half undone).
        const kindOf = (classId: string) => store.getState().types.find((t) => t.id === classId)?.kind;
        for (const [id, classId] of appliedPrevious) {
          if (kindOf(classId) !== "defect") await refuseIfFindingHasContent(ctx, history.resolve(id));
        }
        for (const [id, classId] of appliedPrevious) {
          await retype(history.resolve(id), classId, { confirmFindingDelete: true });
        }
      },
      redo: async () => {
        for (const id of appliedPrevious.keys()) {
          await retype(history.resolve(id), typeId, { confirmFindingDelete: true });
        }
      },
    });
  }
  return outcome;
}

/** Accept or reject suggestions (A / X are FA's keys). Undo is `unreview` (§8.3). */
export function cmdReview(
  ctx: CommandContext,
  ids: string[],
  action: "accept" | "reject",
): Promise<BoxReviewResult | undefined> {
  if (ids.length === 0) return Promise.resolve(undefined);
  return enqueue(ctx, () => reviewNow(ctx, ids, action));
}

async function reviewNow(
  ctx: CommandContext,
  ids: string[],
  action: "accept" | "reject",
): Promise<BoxReviewResult | undefined> {
  const { api, projectId, store, history } = ctx;
  const state = action === "accept" ? "accepted" : "rejected";
  const result = await tracked(ctx, `${action} suggestions`, () => reviewShapes(api, projectId, ids, action));
  if (!result) return undefined;
  store.getState().patchStates(ids, state);
  history.push({
    label: `${action} suggestions`,
    undo: async () => {
      await reviewShapes(api, projectId, ids, "unreview");
      store.getState().patchStates(ids, "unreviewed");
      // index reconciliation 17: an undone accept deletes its finding, so drop the stale link.
      for (const id of ids) store.getState().unlinkFinding(id);
    },
    redo: async () => {
      const r = await reviewShapes(api, projectId, ids, action);
      store.getState().patchStates(ids, state);
      // F10: a redone accept re-creates its finding; re-link it (only unambiguous for a single id).
      if (action === "accept" && ids.length === 1 && r.finding_ids_created.length === 1) {
        store.getState().linkFindings({ [ids[0]]: r.finding_ids_created[0] });
      }
    },
  });
  return result;
}

/** Person shapes are deleted; proposals are rejected (the row stays for its provenance). */
export function cmdDeleteShapes(ctx: CommandContext, ids: string[]): Promise<void> {
  return enqueue(ctx, () => deleteShapesNow(ctx, ids));
}

async function deleteShapesNow(ctx: CommandContext, ids: string[]): Promise<void> {
  const { api, projectId, store, history } = ctx;
  const boxes = ids.map((id) => store.getState().boxes[id]).filter((b): b is Box => !!b);
  if (boxes.length === 0) return;
  const proposals = boxes.filter(isProposal);
  const people = boxes.filter((b) => !isProposal(b));
  const previousStates = new Map(proposals.map((b) => [b.id, b.review_state]));
  const refs = people.map((b) => ({ ref: { id: b.id } as BoxRef, box: b }));
  const ok = await tracked(ctx, "delete", async () => {
    if (proposals.length)
      await reviewShapes(
        api,
        projectId,
        proposals.map((b) => b.id),
        "reject",
      );
    for (const { ref } of refs) await deleteBox(api, projectId, ref.id);
    return true;
  });
  if (!ok) return;
  const apply = () => {
    const s = store.getState();
    for (const b of proposals) {
      s.patchStates([b.id], "rejected");
      s.unlinkFinding(b.id); // m4: rejecting an accepted proposal deletes its finding too.
    }
    for (const { ref } of refs) {
      s.removeBox(ref.id);
      s.unlinkFinding(ref.id); // F11: a deleted shape's finding link is stale.
    }
    s.select([]);
  };
  apply();
  history.push({
    label: "delete",
    undo: async () => {
      for (const { ref, box } of refs) {
        const again = await createShape(api, projectId, box.image_id, bodyOf(box));
        history.alias(ref.id, again.id);
        ref.id = again.id;
        store.getState().upsertBox(again);
        if (again.finding_id) store.getState().linkFindings({ [again.id]: again.finding_id });
      }
      for (const [id, prev] of previousStates) {
        const action = prev === "unreviewed" ? "unreview" : prev === "rejected" ? "reject" : "accept";
        const r = await reviewShapes(api, projectId, [id], action);
        store.getState().patchStates([id], prev === "edited" ? "accepted" : prev);
        // m4: restoring an accepted/edited proposal re-creates its finding; re-link it.
        if (action === "accept" && r.finding_ids_created.length === 1) {
          store.getState().linkFindings({ [id]: r.finding_ids_created[0] });
        }
      }
    },
    redo: async () => {
      if (proposals.length)
        await reviewShapes(
          api,
          projectId,
          proposals.map((b) => b.id),
          "reject",
        );
      for (const { ref } of refs) await deleteBox(api, projectId, ref.id);
      apply();
    },
  });
}

/** Ctrl+D: each selected shape again, offset 12 px, as person shapes. */
export function cmdDuplicate(ctx: CommandContext, ids: string[]): Promise<void> {
  return enqueue(ctx, () => duplicateNow(ctx, ids));
}

async function duplicateNow(ctx: CommandContext, ids: string[]): Promise<void> {
  const { store } = ctx;
  const image = store.getState().image;
  if (!image) return;
  const created: string[] = [];
  for (const id of ids) {
    const box = store.getState().boxes[id];
    if (!box) continue;
    const body = bodyOf(box);
    const dx = Math.min(12, image.width - (box.x + box.w));
    const dy = Math.min(12, image.height - (box.y + box.h));
    if (body.points) body.points = body.points.map(([x, y]) => [x + dx, y + dy]);
    else {
      body.x = (body.x ?? 0) + dx;
      body.y = (body.y ?? 0) + dy;
    }
    const b = await createShapeNow(ctx, box.image_id, body);
    if (b) created.push(b.id);
  }
  if (created.length) store.getState().select(created);
}

export function cmdCreateMeasurement(
  ctx: CommandContext,
  imageId: string,
  a: Point,
  b: Point,
): Promise<ImageMeasurement | undefined> {
  return enqueue(ctx, () => createMeasurementNow(ctx, imageId, a, b));
}

async function createMeasurementNow(
  ctx: CommandContext,
  imageId: string,
  a: Point,
  b: Point,
): Promise<ImageMeasurement | undefined> {
  const { api, projectId, store, history } = ctx;
  const r = (n: number) => Math.round(n * 10) / 10;
  const body = { x1: r(a.x), y1: r(a.y), x2: r(b.x), y2: r(b.y) };
  const created = await tracked(ctx, "measure", () => createImageMeasurement(api, projectId, imageId, body));
  if (!created) return undefined;
  store.getState().upsertMeasurement(created);
  const ref = { id: created.id };
  history.push({
    label: "measure",
    undo: async () => {
      await deleteImageMeasurement(api, projectId, ref.id);
      store.getState().removeMeasurement(ref.id);
    },
    redo: async () => {
      const again = await createImageMeasurement(api, projectId, imageId, body);
      ref.id = again.id;
      store.getState().upsertMeasurement(again);
    },
  });
  return created;
}

export function cmdDeleteMeasurement(ctx: CommandContext, id: string): Promise<void> {
  return enqueue(ctx, () => deleteMeasurementNow(ctx, id));
}

async function deleteMeasurementNow(ctx: CommandContext, id: string): Promise<void> {
  const { api, projectId, store, history } = ctx;
  const m = store.getState().measurements[id];
  if (!m) return;
  const ok = await tracked(ctx, "delete measurement", async () => {
    await deleteImageMeasurement(api, projectId, id);
    return true;
  });
  if (!ok) return;
  store.getState().removeMeasurement(id);
  const ref = { id };
  const body = { x1: m.x1, y1: m.y1, x2: m.x2, y2: m.y2, ...(m.label ? { label: m.label } : {}) }; // label "" = none
  history.push({
    label: "delete measurement",
    undo: async () => {
      const again = await createImageMeasurement(api, projectId, m.image_id, body);
      ref.id = again.id;
      store.getState().upsertMeasurement(again);
    },
    redo: async () => {
      await deleteImageMeasurement(api, projectId, ref.id);
      store.getState().removeMeasurement(ref.id);
    },
  });
}

/** Queued like any command, so Ctrl+Z pressed while a save is in flight undoes it once it lands. */
export async function cmdUndo(ctx: CommandContext): Promise<void> {
  await enqueue(ctx, () => tracked(ctx, "undo", () => ctx.history.undo()));
}

export async function cmdRedo(ctx: CommandContext): Promise<void> {
  await enqueue(ctx, () => tracked(ctx, "redo", () => ctx.history.redo()));
}
