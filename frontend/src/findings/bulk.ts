import type { ApiClient } from "@contract/client";
import { bulkUpdateFindings, FINDINGS_BULK_MAX, type BulkResult, type BulkSet } from "@/api/findings";

/** One transaction per ≤ 1000 ids (F §8.3); larger selections are chunked and the results summed. */
export async function applyBulk(
  api: ApiClient,
  projectId: string,
  ids: readonly string[],
  set: BulkSet,
): Promise<BulkResult> {
  let updated = 0;
  const skipped: BulkResult["skipped"] = [];
  for (let i = 0; i < ids.length; i += FINDINGS_BULK_MAX) {
    const r = await bulkUpdateFindings(api, projectId, ids.slice(i, i + FINDINGS_BULK_MAX), set);
    updated += r.updated;
    skipped.push(...r.skipped);
  }
  return { updated, skipped };
}

const SKIP_REASON: Record<string, string> = {
  invalid_transition: "a closed finding has to be reopened first",
};

/** "3 findings set to Closed." plus why any were skipped. */
export function bulkMessage(updated: number, skipped: BulkResult["skipped"], what: string): string {
  const head = `${updated} ${updated === 1 ? "finding" : "findings"} set to ${what}.`;
  if (skipped.length === 0) return head;
  const codes = [...new Set(skipped.map((s) => s.code))];
  const why = codes.map((c) => SKIP_REASON[c] ?? c.replace(/_/g, " ")).join("; ");
  return `${head} ${skipped.length} skipped: ${why}.`;
}
