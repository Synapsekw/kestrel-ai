/** F §8.1: `F-` plus at least four digits. */
export function formatFindingNumber(n: number): string {
  return `F-${String(n).padStart(4, "0")}`;
}

/** "just now", "12 min ago", "3 h ago", "yesterday", "4 d ago", then "12 Sep". */
export function relativeTime(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} d ago`;
  const date = new Date(t);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export type CreatedBy = { kind: "human" } | { kind: "model"; modelId: string };

/** `created_by` is `human` or `model:<library_model_id>` (F §8.1). */
export function parseCreatedBy(v: string): CreatedBy {
  return v.startsWith("model:") && v.length > 6 ? { kind: "model", modelId: v.slice(6) } : { kind: "human" };
}

export function formatPercent(v: number | null): string | null {
  return v === null ? null : `${Math.round(v * 100)}%`;
}
