// src/assetmodels/review/findingRows.ts
import type { AssetModel } from "@contract/client";
import type { Finding, FindingListQuery } from "@/api/findings";
import type { FocusSettings } from "@/assetmodels/viewer/focus";
import { formatFindingNumber } from "@/findings/format";
import type { TopicItem } from "@/ui";
import { severityOf, type SeverityLevel } from "@/ui/severityScale";

export type AssetReview = NonNullable<AssetModel["review"]>;
export type Placed = "all" | "placed" | "unplaced";

export interface FindingsFilter {
  severity: string | null;
  typeId: string | null;
  zone: string | null;
  side: string | null;
  placed: Placed;
}

export const NO_FILTER: FindingsFilter = {
  severity: null,
  typeId: null,
  zone: null,
  side: null,
  placed: "all",
};

export type AssetFindingsQuery = Omit<FindingListQuery, "asset_model_id" | "cursor" | "limit">;

export function findingsQuery(f: FindingsFilter): AssetFindingsQuery {
  const q: AssetFindingsQuery = { sort: "-severity" };
  if (f.severity) q.severity = [f.severity];
  if (f.typeId) q.type_id = [f.typeId];
  if (f.zone) q.zone = [f.zone];
  if (f.side) q.side = [f.side];
  if (f.placed !== "all") q.placed = f.placed === "placed";
  return q;
}

export function isFiltered(f: FindingsFilter): boolean {
  return Boolean(f.severity || f.typeId || f.zone || f.side || f.placed !== "all");
}

export function heightText(m: number | null | undefined): string | null {
  return m === null || m === undefined ? null : `${m.toFixed(1)} m`;
}

export function zoneOptions(review: AssetReview | null): { value: string; label: string }[] {
  return (review?.zones ?? []).map((z) => ({ value: z.id, label: z.label }));
}

export function sideOptions(review: AssetReview | null): { value: string; label: string }[] {
  return (review?.sides?.labels ?? []).map((l) => ({ value: l, label: l }));
}

export function zoneLabel(review: AssetReview | null, zone: string | null | undefined): string | null {
  if (!zone) return null;
  return review?.zones?.find((z) => z.id === zone)?.label ?? zone;
}

export function findingItem(
  f: Finding,
  typeName: string | undefined,
  scale: readonly SeverityLevel[],
  review: AssetReview | null,
): TopicItem {
  const placed = f.placement === "point" || f.placement === "patch";
  const meta = placed
    ? [zoneLabel(review, f.zone), f.side, heightText(f.height_m)].filter(Boolean).join(" · ")
    : "Not placed";
  return {
    id: f.id,
    label: [formatFindingNumber(f.number), typeName].filter(Boolean).join(" · "),
    meta,
    swatch: severityOf(scale, f.severity)?.colour,
  };
}

export function focusSettingsOf(review: AssetReview | null): FocusSettings | undefined {
  const f = review?.focus;
  if (!f) return undefined;
  return { frustum: [f.frustum[0], f.frustum[1]], oblique_deg: f.oblique_deg ?? 0 };
}
