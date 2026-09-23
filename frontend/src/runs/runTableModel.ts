import type { ClassDef } from "@contract/client";
import type { RunSummary } from "@/api/runs";
import type { PillTone } from "@/ui";

export const fmt = (n: number) => new Intl.NumberFormat("en-GB").format(n).replace(/,/g, " ");

export const STATE: Record<string, { text: string; tone: PillTone; live?: boolean }> = {
  queued: { text: "Queued", tone: "neutral", live: true },
  running: { text: "Running", tone: "accent", live: true },
  succeeded: { text: "Done", tone: "ok" },
  failed: { text: "Failed", tone: "danger" },
  cancelled: { text: "Cancelled", tone: "neutral" },
};

/** "412 of 530 reviewed", or "Nothing found" for a run with no detections. */
export function reviewText(review: RunSummary["review"]): string {
  if (review.total === 0) return "Nothing found";
  return `${fmt(review.reviewed)} of ${fmt(review.total)} reviewed`;
}

/** Per class "total (verified)", in the project's class order; classes the run did not find are left out. */
export function countCells(
  run: RunSummary,
  classes: ClassDef[],
): { id: string; name: string; colour: string; text: string }[] {
  const known = classes.filter((c) => run.counts[c.id]);
  const unknown = Object.keys(run.counts).filter((id) => !classes.some((c) => c.id === id));
  return [
    ...known.map((c) => ({ id: c.id, name: c.name, colour: c.colour, total: run.counts[c.id] })),
    ...unknown.map((id) => ({ id, name: "deleted class", colour: "currentColor", total: run.counts[id] })),
  ].map(({ total, ...c }) => ({ ...c, text: `${fmt(total)} (${fmt(run.verified_counts[c.id] ?? 0)})` }));
}
