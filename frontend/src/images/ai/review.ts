import type { ApiClient, Box } from "@contract/client";
import { messageOf } from "@/api/errors";
import { fetchFinding, patchFinding } from "@/api/findings";
import { formatFindingNumber } from "@/findings/format";
import { useChangesStore } from "@/store/changes";
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
 * still out.
 */
export async function cmdReviewSuggestions(
  ctx: CommandContext,
  ids: string[],
  action: "accept" | "reject",
): Promise<ReviewResult | undefined> {
  if (ids.length === 0) return undefined;
  const before = ids.map((id) => wsGet().boxes[id]).filter((b): b is Box => Boolean(b));
  useAiStore.getState().markInFlight(ids);
  let result: ReviewResult | undefined;
  try {
    result = await cmdReview(ctx, ids, action);
  } finally {
    useAiStore.getState().clearInFlight(ids);
  }
  if (!result) return undefined; // FC's `tracked` recorded the failure: "Save failed · Retry"
  const s = wsGet();
  useAiStore
    .getState()
    .addLeaving(
      before.map((box) => ({
        box,
        kind: action,
        colour: action === "accept" ? (typeOf(s, box.class_id)?.colour ?? null) : null,
      })),
    );
  const created = result.finding_ids_created;
  if (action === "accept") {
    // R-FA2: one id ↔ one finding is certain only for a single accept; FW links the rest from the
    // image's findings list, which re-reads on the bump.
    if (ids.length === 1 && created.length === 1) s.linkFindings({ [ids[0]]: created[0] });
    if (created.length > 0) useChangesStore.getState().bumpFindings();
    if (ids.length === 1) {
      s.focusSuggestion(null);
      s.select([ids[0]]); // R-FA11: the inspector opens the new finding
    }
    void toastAccept(ctx, ids, created);
  } else {
    const after = wsGet();
    const next = targetOf(visibleSuggestions(after.boxes, after.order, visibilityNow()), null);
    after.focusSuggestion(next?.id ?? null); // R-FA11: X X X clears a run
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
    await patchFinding(api, projectId, findingId, { severity: level });
    useChangesStore.getState().bumpFindings();
  } catch (e) {
    toast("danger", `Could not set the severity: ${messageOf(e, "unknown error")}`);
  }
}
