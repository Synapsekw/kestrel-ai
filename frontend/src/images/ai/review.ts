import type { ApiClient, Box } from "@contract/client";
import { messageOf } from "@/api/errors";
import { fetchFinding, patchFinding } from "@/api/findings";
import { formatFindingNumber } from "@/findings/format";
import { useChangesStore } from "@/store/changes";
import { ownFindingsWrite } from "@/store/changesOwnWrite";
import { toast } from "@/ui";
import { useAiStore, visibilityNow } from "./aiStore";
import type { ReviewResult } from "./api";
import { cmdReview, typeOf, wsGet, type CommandContext } from "./bridge";
import { targetOf, visibleSuggestions } from "./suggestions";

export const BULK_CONFIRM_ABOVE = 20;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

async function toastAccept(ctx: CommandContext, ids: string[], created: string[]): Promise<void> {
  if (ids.length > 1) {
    const found = created.length ? ` · ${plural(created.length, "finding", "findings")}` : "";
    toast("ok", `✓ Accepted ${plural(ids.length, "suggestion", "suggestions")}${found}`);
    return;
  }
  if (created.length === 0) {
    toast("ok", "✓ Accepted as an object");
    return;
  }
  try {
    const f = await fetchFinding(ctx.api, ctx.projectId, created[0]);
    toast("ok", `✓ Accepted as finding ${formatFindingNumber(f.number)}`);
  } catch {
    toast("ok", "✓ Accepted as a finding");
  }
}

/**
 * A / X / Shift+A / Shift+X (spec §11.4) on top of FC's `cmdReview`. The ids leave the targets at
 * once (`inFlight`), so a second key press acts on the next suggestion while the first request is
 * still out; their outlines stay drawn as still, non-interactive `held` ghosts until the answer
 * starts the accept morph or reject fade (a failure drops them and the suggestion is back).
 *
 * The answer can arrive after the operator moved to another image: then FA only toasts and bumps
 * the findings list; it never links, selects, focuses or ghosts on the image now loaded.
 */
export async function cmdReviewSuggestions(
  ctx: CommandContext,
  ids: string[],
  action: "accept" | "reject",
): Promise<ReviewResult | undefined> {
  if (ids.length === 0) return undefined;
  const imageId = wsGet().imageId;
  const before = ids.map((id) => wsGet().boxes[id]).filter((b): b is Box => Boolean(b));
  const ai = () => useAiStore.getState();
  ai().markInFlight(ids);
  ai().addLeaving(before.map((box) => ({ box, kind: "held" as const, colour: null })));
  let result: ReviewResult | undefined;
  try {
    result = await cmdReview(ctx, ids, action);
  } finally {
    ai().clearInFlight(ids);
  }
  const s = wsGet();
  const current = s.imageId === imageId;
  if (!result || !current) ai().dropHeld(ids);
  if (!result) return undefined; // FC's `tracked` recorded the failure: "Save failed · Retry"
  if (current) {
    ai().addLeaving(
      before.map((box) => ({
        box,
        kind: action,
        colour: action === "accept" ? (typeOf(s, box.class_id)?.colour ?? null) : null,
      })),
    );
  }
  const created = result.finding_ids_created;
  if (action === "accept") {
    // R-FA2: one id ↔ one finding is certain only for a single accept; FW links the rest from the
    // image's findings list, which re-reads on the bump.
    if (current && ids.length === 1 && created.length === 1) s.linkFindings({ [ids[0]]: created[0] });
    if (created.length > 0) useChangesStore.getState().bumpFindings();
    if (current && ids.length === 1) {
      s.focusSuggestion(null);
      s.select([ids[0]]); // R-FA11: the inspector opens the new finding
    }
    void toastAccept(ctx, ids, created);
  } else {
    if (current) {
      const after = wsGet();
      const next = targetOf(visibleSuggestions(after.boxes, after.order, visibilityNow()), null);
      after.focusSuggestion(next?.id ?? null); // R-FA11: X X X clears a run
    }
    toast(
      "info",
      ids.length === 1
        ? "✕ Rejected · kept as a training negative"
        : `✕ Rejected ${plural(ids.length, "suggestion", "suggestions")} · kept as training negatives`,
    );
  }
  return result;
}

/** R-FA3: digits grade the selected box's finding; the inspector re-reads on the bump. */
export async function setFindingSeverity(
  api: ApiClient,
  projectId: string,
  findingId: string,
  level: number,
): Promise<void> {
  try {
    // Own-write echo dedupe (rulings R8): the server's `findings.changed` echo of this same write
    // must not re-read the inspector and the findings list a second time.
    await ownFindingsWrite([findingId], () => patchFinding(api, projectId, findingId, { severity: level }));
  } catch (e) {
    toast("danger", `Could not set the severity: ${messageOf(e, "unknown error")}`);
  }
}
