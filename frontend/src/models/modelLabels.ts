import type { Model } from "@contract/client";

const KIND_LABEL: Record<Model["kind"], string> = { imported: "Imported", trained: "Trained" };

/** An en dash stands in for a metric the model does not have (an imported model has none). */
export function formatMetric(v: number | null | undefined): string {
  return typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "–";
}

/** `YYYY-MM-DD HH:mm` in UTC, deterministic across locales (same shape as the Data Manager). */
export function formatDate(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

export function kindLabel(kind: Model["kind"]): string {
  return KIND_LABEL[kind];
}
