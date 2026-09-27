import { useMemo } from "react";
import type { ApiClient, Box, BoxCreate, BoxUpdate } from "@contract/client";
import { deleteBox } from "@/api/boxes";
import { useApi } from "@/api/client";
import { ApiFailure, codeOf, messageOf } from "@/api/errors";
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
 * The context of whichever command most recently ran. There is only ever one open image (one
 * `CommandContext`) at a time, but a command's `undo`/`redo` closure is created once, at push
 * time, and may run much later; reading `api`/`projectId` through this indirection (instead of
 * closing over the values captured at push time) means undo/redo always talk to the *current*
 * api client and project, not a stale one from whenever the command was first run.
 */
let activeCtx: CommandContext | null = null;

function live(ctx: CommandContext): CommandContext {
  return activeCtx ?? ctx;
}

/** Queues a whole command behind the earlier ones of the same image, so history order equals action order. */
export function enqueue<T>(ctx: CommandContext, fn: () => Promise<T>): Promise<T> {
  activeCtx = ctx;
  ctx.store.getState().beginRequest();
  return ctx.history.run(fn).finally(() => ctx.store.getState().endRequest());
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
  activeCtx = ctx;
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

export async function cmdCreateShape(
  ctx: CommandContext,
  imageId: string,
  body: BoxCreate,
): Promise<BoxWriteResult | undefined> {
  const { store, history } = ctx;
  const run = () => createShape(live(ctx).api, live(ctx).projectId, imageId, body);
  const retry = () => void tracked(ctx, "draw shape", run).then((b) => b && afterCreate(ctx, b));
  const created = await tracked(ctx, "draw shape", run, retry);
  if (!created) return undefined;
  afterCreate(ctx, created);
  const ref: BoxRef = { id: created.id };
  history.push({
    label: "draw shape",
    undo: async () => {
      const { api, projectId } = live(ctx);
      await deleteBox(api, projectId, ref.id);
      store.getState().removeBox(ref.id);
      store.getState().unlinkFinding(ref.id);
    },
    redo: async () => {
      const { api, projectId } = live(ctx);
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

/** Move/resize/rotate a box or rbox, move a point, or replace a polygon's points (R-BA6). */
export async function cmdUpdateShape(ctx: CommandContext, id: string, after: ShapePatch): Promise<void> {
  const { api, projectId, store, history } = ctx;
  const box = store.getState().boxes[id];
  if (!box) return;
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
      const live_ = live(ctx);
      const current = history.resolve(id);
      store.getState().upsertBox(await updateShape(live_.api, live_.projectId, current, patchBody(before)));
      if (restoreProposal) {
        await reviewShapes(live_.api, live_.projectId, [current], "unreview");
        store.getState().patchStates([current], "unreviewed");
      }
    },
    redo: async () => {
      const live_ = live(ctx);
      store
        .getState()
        .upsertBox(await updateShape(live_.api, live_.projectId, history.resolve(id), patchBody(after)));
    },
  });
}

/**
 * Retype one or more shapes. `needs-confirm` when F refuses a defect → object change that would
 * delete a finding (409 finding_would_be_deleted); the caller confirms and calls again with
 * `confirmFindingDelete` (ruling FC-R5). Undo retypes back with confirm (FC-R3).
 */
export async function cmdSetType(
  ctx: CommandContext,
  ids: string[],
  typeId: string,
  opts: { confirmFindingDelete?: boolean } = {},
): Promise<"done" | "needs-confirm" | "failed"> {
  const { api, projectId, store, history } = ctx;
  const targets = ids
    .map((id) => store.getState().boxes[id])
    .filter((b): b is Box => !!b && b.class_id !== typeId);
  if (targets.length === 0) return "done";
  const previous = new Map(targets.map((b) => [b.id, b.class_id]));
  activeCtx = ctx;
  store.getState().beginRequest();
  store.getState().clearFailure();
  try {
    for (const b of targets) {
      store.getState().upsertBox(await updateShape(api, projectId, b.id, { class_id: typeId }, opts));
    }
  } catch (e) {
    if (e instanceof ApiFailure && e.code === "finding_would_be_deleted") return "needs-confirm";
    pushLog(`change type failed: ${messageOf(e, String(e))}`);
    store.getState().fail(failureText("change type", e));
    return "failed";
  } finally {
    store.getState().endRequest();
  }
  history.push({
    label: "change type",
    undo: async () => {
      const live_ = live(ctx);
      for (const [id, classId] of previous) {
        store
          .getState()
          .upsertBox(
            await updateShape(
              live_.api,
              live_.projectId,
              history.resolve(id),
              { class_id: classId },
              { confirmFindingDelete: true },
            ),
          );
      }
    },
    redo: async () => {
      const live_ = live(ctx);
      for (const id of previous.keys()) {
        store
          .getState()
          .upsertBox(
            await updateShape(
              live_.api,
              live_.projectId,
              history.resolve(id),
              { class_id: typeId },
              { confirmFindingDelete: true },
            ),
          );
      }
    },
  });
  return "done";
}

/** Accept or reject suggestions (A / X are FA's keys). Undo is `unreview` (§8.3). */
export async function cmdReview(
  ctx: CommandContext,
  ids: string[],
  action: "accept" | "reject",
): Promise<BoxReviewResult | undefined> {
  if (ids.length === 0) return undefined;
  const { api, projectId, store, history } = ctx;
  const state = action === "accept" ? "accepted" : "rejected";
  const result = await tracked(ctx, `${action} suggestions`, () => reviewShapes(api, projectId, ids, action));
  if (!result) return undefined;
  store.getState().patchStates(ids, state);
  history.push({
    label: `${action} suggestions`,
    undo: async () => {
      const live_ = live(ctx);
      await reviewShapes(live_.api, live_.projectId, ids, "unreview");
      store.getState().patchStates(ids, "unreviewed");
      // index reconciliation 17: an undone accept deletes its finding, so drop the stale link.
      for (const id of ids) store.getState().unlinkFinding(id);
    },
    redo: async () => {
      const live_ = live(ctx);
      const r = await reviewShapes(live_.api, live_.projectId, ids, action);
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
export async function cmdDeleteShapes(ctx: CommandContext, ids: string[]): Promise<void> {
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
    if (proposals.length)
      s.patchStates(
        proposals.map((b) => b.id),
        "rejected",
      );
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
      const live_ = live(ctx);
      for (const { ref, box } of refs) {
        const again = await createShape(live_.api, live_.projectId, box.image_id, bodyOf(box));
        history.alias(ref.id, again.id);
        ref.id = again.id;
        store.getState().upsertBox(again);
        if (again.finding_id) store.getState().linkFindings({ [again.id]: again.finding_id });
      }
      for (const [id, prev] of previousStates) {
        const action = prev === "unreviewed" ? "unreview" : prev === "rejected" ? "reject" : "accept";
        await reviewShapes(live_.api, live_.projectId, [id], action);
        store.getState().patchStates([id], prev === "edited" ? "accepted" : prev);
      }
    },
    redo: async () => {
      const live_ = live(ctx);
      if (proposals.length)
        await reviewShapes(
          live_.api,
          live_.projectId,
          proposals.map((b) => b.id),
          "reject",
        );
      for (const { ref } of refs) await deleteBox(live_.api, live_.projectId, ref.id);
      apply();
    },
  });
}

/** Ctrl+D: each selected shape again, offset 12 px, as person shapes. */
export async function cmdDuplicate(ctx: CommandContext, ids: string[]): Promise<void> {
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
    const b = await cmdCreateShape(ctx, box.image_id, body);
    if (b) created.push(b.id);
  }
  if (created.length) store.getState().select(created);
}

export async function cmdCreateMeasurement(
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
      const live_ = live(ctx);
      await deleteImageMeasurement(live_.api, live_.projectId, ref.id);
      store.getState().removeMeasurement(ref.id);
    },
    redo: async () => {
      const live_ = live(ctx);
      const again = await createImageMeasurement(live_.api, live_.projectId, imageId, body);
      ref.id = again.id;
      store.getState().upsertMeasurement(again);
    },
  });
  return created;
}

export async function cmdDeleteMeasurement(ctx: CommandContext, id: string): Promise<void> {
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
      const live_ = live(ctx);
      const again = await createImageMeasurement(live_.api, live_.projectId, m.image_id, body);
      ref.id = again.id;
      store.getState().upsertMeasurement(again);
    },
    redo: async () => {
      const live_ = live(ctx);
      await deleteImageMeasurement(live_.api, live_.projectId, ref.id);
      store.getState().removeMeasurement(ref.id);
    },
  });
}

export async function cmdUndo(ctx: CommandContext): Promise<void> {
  await tracked(ctx, "undo", () => ctx.history.undo());
}

export async function cmdRedo(ctx: CommandContext): Promise<void> {
  await tracked(ctx, "redo", () => ctx.history.redo());
}
