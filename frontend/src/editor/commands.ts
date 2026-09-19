import type { ApiClient, Box, BoxCreate, ReviewState } from "@contract/client";
import { createBox, deleteBox, reviewBoxes, updateBox } from "@/api/boxes";
import { messageOf } from "@/api/errors";
import { setMarkedEmpty } from "@/api/images";
import { pushLog } from "@/app/diagnostics";
import { hasGroundTruth, hiddenProposalCount, type EditorStore } from "@/store/editor";
import { duplicateOffset, rectEquals, rectOf, roundRect, type Rect } from "./geometry";
import type { BoxRef, History } from "./history";

export interface CommandContext {
  api: ApiClient;
  projectId: string;
  store: EditorStore;
  history: History;
}

/** A decision the editor takes on proposals; `unreview` is only ever issued by undo. */
export type ReviewDecision = "accept" | "reject";

/**
 * Queues a whole command behind the earlier ones of the same image so history order equals action
 * order; the pending counter covers the wait in the queue too, so "Saving" and `waitForIdle` see it.
 */
export function enqueue<T>(ctx: CommandContext, fn: () => Promise<T>): Promise<T> {
  ctx.store.getState().beginRequest();
  return ctx.history.run(fn).finally(() => ctx.store.getState().endRequest());
}

/** Runs one API interaction with the pending counter and error capture; resolves `undefined` on failure. */
export async function tracked<T>(
  ctx: CommandContext,
  label: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  ctx.store.getState().beginRequest();
  ctx.store.getState().setError(null);
  try {
    return await fn();
  } catch (e) {
    pushLog(`${label} failed: ${messageOf(e, String(e))}`);
    ctx.store.getState().setError(`${label} failed: ${messageOf(e, "unknown error")}`);
    return undefined;
  } finally {
    ctx.store.getState().endRequest();
  }
}

/** Model and cloud boxes are proposals: the review endpoint acts on them and ignores person boxes. */
function isProposal(box: Box): boolean {
  return box.provenance.kind !== "person";
}

/**
 * Puts a proposal back to the review state it had before a command (undo of an edit, a delete or a
 * decision): `unreview` for unreviewed, otherwise the matching decision. `edited` cannot be set
 * through the review endpoint, so it comes back as `accepted` (ground truth either way).
 */
async function restoreReviewState(ctx: CommandContext, id: string, previous: ReviewState): Promise<void> {
  const { api, projectId, store } = ctx;
  const action = previous === "unreviewed" ? "unreview" : previous === "rejected" ? "reject" : "accept";
  const state: ReviewState = previous === "edited" ? "accepted" : previous;
  await reviewBoxes(api, projectId, [id], action);
  store.getState().patchStates([id], state);
}

/** The review state an edit (PATCH) has to restore on undo: only proposals change state, and `edited` stays. */
function stateToRestore(box: Box | undefined): ReviewState | null {
  return box && isProposal(box) && box.review_state !== "edited" ? box.review_state : null;
}

/** Spec section 6: every edit is a Box row immediately; undo issues the compensating call. */
export async function cmdCreateBox(
  ctx: CommandContext,
  imageId: string,
  body: BoxCreate,
): Promise<Box | undefined> {
  const { api, projectId, store, history } = ctx;
  const created = await tracked(ctx, "draw box", () => createBox(api, projectId, imageId, body));
  if (!created) return undefined;
  store.getState().upsertBox(created);
  store.getState().select(created.id);
  // The store itself clears `marked_empty` when a ground-truth box lands (upsertBox), mirroring
  // the backend's own transaction — no special case needed here.
  const ref: BoxRef = { id: created.id };
  history.push({
    label: "draw box",
    undo: async () => {
      await deleteBox(api, projectId, ref.id);
      store.getState().removeBox(ref.id);
    },
    redo: async () => {
      const again = await createBox(api, projectId, imageId, body);
      history.alias(ref.id, again.id);
      ref.id = again.id;
      store.getState().upsertBox(again);
      store.getState().select(again.id);
    },
  });
  return created;
}

export async function cmdUpdateRect(
  ctx: CommandContext,
  id: string,
  before: Rect,
  after: Rect,
): Promise<void> {
  if (rectEquals(before, after)) return;
  const { api, projectId, store, history } = ctx;
  const restore = stateToRestore(store.getState().boxes[id]);
  const updated = await tracked(ctx, "move box", () => updateBox(api, projectId, id, after));
  if (!updated) return;
  store.getState().upsertBox(updated);
  history.push({
    label: "move box",
    // `resolve`: the box may have been deleted and re-created (new id) by an undo/redo in between.
    undo: async () => {
      const current = history.resolve(id);
      store.getState().upsertBox(await updateBox(api, projectId, current, before));
      if (restore) await restoreReviewState(ctx, current, restore);
    },
    redo: async () => store.getState().upsertBox(await updateBox(api, projectId, history.resolve(id), after)),
  });
}

export async function cmdSetClass(ctx: CommandContext, id: string, classId: string): Promise<void> {
  const { api, projectId, store, history } = ctx;
  const box = store.getState().boxes[id];
  if (!box || box.class_id === classId) return;
  const previous = box.class_id;
  const restore = stateToRestore(box);
  const updated = await tracked(ctx, "change class", () =>
    updateBox(api, projectId, id, { class_id: classId }),
  );
  if (!updated) return;
  store.getState().upsertBox(updated);
  history.push({
    label: "change class",
    undo: async () => {
      const current = history.resolve(id);
      store.getState().upsertBox(await updateBox(api, projectId, current, { class_id: previous }));
      if (restore) await restoreReviewState(ctx, current, restore);
    },
    redo: async () =>
      store.getState().upsertBox(await updateBox(api, projectId, history.resolve(id), { class_id: classId })),
  });
}

/** Delete on a person box removes the row; delete on a proposal rejects it (the row stays for its provenance). */
export async function cmdDelete(ctx: CommandContext, id: string): Promise<void> {
  const { api, projectId, store, history } = ctx;
  const box = store.getState().boxes[id];
  if (!box) return;
  if (isProposal(box)) {
    const previous = box.review_state;
    const ok = await tracked(ctx, "delete box", () => reviewBoxes(api, projectId, [id], "reject"));
    if (ok === undefined) return;
    const reject = () => {
      store.getState().patchStates([id], "rejected");
      if (store.getState().selectedId === id) store.getState().select(null);
    };
    reject();
    history.push({
      label: "delete box",
      undo: () => restoreReviewState(ctx, id, previous),
      redo: async () => {
        await reviewBoxes(api, projectId, [id], "reject");
        reject();
      },
    });
    return;
  }
  const ok = await tracked(ctx, "delete box", async () => {
    await deleteBox(api, projectId, id);
    return true;
  });
  if (!ok) return;
  store.getState().removeBox(id);
  const ref: BoxRef = { id };
  const body: BoxCreate = { class_id: box.class_id, x: box.x, y: box.y, w: box.w, h: box.h };
  history.push({
    label: "delete box",
    undo: async () => {
      const again = await createBox(api, projectId, box.image_id, body);
      history.alias(ref.id, again.id);
      ref.id = again.id;
      store.getState().upsertBox(again);
    },
    redo: async () => {
      await deleteBox(api, projectId, ref.id);
      store.getState().removeBox(ref.id);
    },
  });
}

export async function cmdDuplicate(ctx: CommandContext, id: string): Promise<Box | undefined> {
  const { store } = ctx;
  const box = store.getState().boxes[id];
  const image = store.getState().image;
  if (!box || !image) return undefined;
  const rect = roundRect(duplicateOffset(rectOf(box), image));
  return cmdCreateBox(ctx, box.image_id, { class_id: box.class_id, ...rect });
}

/** A and R (and the per-row buttons) act on unreviewed proposals; undo puts them back with `unreview`. */
export async function cmdReview(ctx: CommandContext, ids: string[], action: ReviewDecision): Promise<void> {
  if (ids.length === 0) return;
  const { api, projectId, store, history } = ctx;
  const state: ReviewState = action === "accept" ? "accepted" : "rejected";
  const ok = await tracked(ctx, `${action} proposals`, () => reviewBoxes(api, projectId, ids, action));
  if (ok === undefined) return;
  store.getState().patchStates(ids, state);
  history.push({
    label: `${action} suggestions`,
    undo: async () => {
      await reviewBoxes(api, projectId, ids, "unreview");
      store.getState().patchStates(ids, "unreviewed");
    },
    redo: async () => {
      await reviewBoxes(api, projectId, ids, action);
      store.getState().patchStates(ids, state);
    },
  });
}

/** The one wording used everywhere a mark is refused because of existing ground truth (M3). */
export const GROUND_TRUTH_MESSAGE = "This image has accepted boxes. Delete or reject them first.";

const MARK_NOTICE =
  "Marked as empty: this image counts as labeled and enters datasets as a negative example.";
const UNMARK_NOTICE = "No longer marked empty.";

/** Marks `imageId` empty; returns the ids of the proposals it rejected (for undo). */
async function markEmpty(ctx: CommandContext, imageId: string): Promise<string[]> {
  const { api, projectId, store } = ctx;
  // Captured before the await: a store whose image changes mid-flight must reject exactly the
  // proposals that were visible when the command started, not whatever is loaded once it resolves.
  const rejectIds = Object.values(store.getState().boxes)
    .filter((b) => b.review_state === "unreviewed")
    .map((b) => b.id);
  const updated = await setMarkedEmpty(api, projectId, imageId, true);
  if (store.getState().imageId !== imageId) return rejectIds; // navigated away meanwhile
  store.getState().setImage(updated);
  if (rejectIds.length) store.getState().patchStates(rejectIds, "rejected");
  store.getState().setNotice(MARK_NOTICE);
  return rejectIds;
}

/** Unmarks `imageId`; never touches boxes (unmarking never resurrects a rejected proposal). */
async function unmarkEmpty(ctx: CommandContext, imageId: string): Promise<void> {
  const { api, projectId, store } = ctx;
  const updated = await setMarkedEmpty(api, projectId, imageId, false);
  if (store.getState().imageId !== imageId) return;
  store.getState().setImage(updated);
  store.getState().setNotice(UNMARK_NOTICE);
}

/** Undo of a mark: unmark, then put back to `unreviewed` exactly the proposals it rejected. */
async function undoMark(ctx: CommandContext, imageId: string, rejectedIds: string[]): Promise<void> {
  await unmarkEmpty(ctx, imageId);
  if (rejectedIds.length && ctx.store.getState().imageId === imageId) {
    await reviewBoxes(ctx.api, ctx.projectId, rejectedIds, "unreview");
    if (ctx.store.getState().imageId === imageId) ctx.store.getState().patchStates(rejectedIds, "unreviewed");
  }
}

/**
 * "No machinery on this image" (spec section 6, walk-through item E4). A mark is refused locally,
 * without a request, when the store already has a ground-truth box (M3) — the store owns that
 * invariant (I1), so this never races the backend's own 409. Both directions go on the undo stack
 * (I2a): undoing a mark restores exactly the proposals it rejected; undoing an unmark marks again,
 * rejecting whatever is unreviewed at that moment (kept simple, same as a fresh mark).
 */
export async function cmdToggleEmpty(ctx: CommandContext): Promise<void> {
  const { store, history } = ctx;
  const image = store.getState().image;
  if (!image) return;
  const imageId = image.id;
  const next = !image.marked_empty;
  if (next && hasGroundTruth(store.getState().boxes)) {
    store.getState().setError(GROUND_TRUTH_MESSAGE);
    return;
  }
  // Marking rejects every unreviewed proposal. While the confidence floor hides some of them the
  // analyst would reject what they never saw, so the mark waits until they are in view.
  const hidden = next ? hiddenProposalCount(store.getState()) : 0;
  if (hidden > 0) {
    store
      .getState()
      .setError(
        `${hidden} ${hidden === 1 ? "suggestion is" : "suggestions are"} hidden by the confidence floor. Lower it and look before marking the image as empty.`,
      );
    return;
  }
  store.getState().beginRequest();
  store.getState().setError(null);
  try {
    if (next) {
      const rejectIds = await markEmpty(ctx, imageId);
      history.push({
        label: "mark empty",
        undo: () => undoMark(ctx, imageId, rejectIds),
        redo: () => markEmpty(ctx, imageId).then(() => undefined),
      });
    } else {
      await unmarkEmpty(ctx, imageId);
      history.push({
        label: "unmark empty",
        undo: () => markEmpty(ctx, imageId).then(() => undefined),
        redo: () => unmarkEmpty(ctx, imageId),
      });
    }
  } catch (e) {
    if (store.getState().imageId === imageId) {
      pushLog(`mark empty failed: ${messageOf(e, String(e))}`);
      store.getState().setError(messageOf(e, "could not update the mark"));
    }
  } finally {
    store.getState().endRequest();
  }
}

export async function cmdUndo(ctx: CommandContext): Promise<void> {
  await tracked(ctx, "undo", () => ctx.history.undo());
}

export async function cmdRedo(ctx: CommandContext): Promise<void> {
  await tracked(ctx, "redo", () => ctx.history.redo());
}
