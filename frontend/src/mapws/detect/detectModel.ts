import type { MapRun } from "@contract/client";
import type { MapSide, Selection, Survey } from "@/mapws/w4host";

/** Maps whose runs one pane draws at most (plan budget). */
export const MAX_SURVEY_MAPS = 20;

export interface DetectFilters {
  pending: boolean;
  /** Accepted or edited object detections (machinery counts). */
  accepted: boolean;
  /** Accepted defects: findings now, so off by default (spec §9.3). */
  findings: boolean;
  rejected: boolean;
  allSurveys: boolean;
  hiddenTypes: ReadonlySet<string>;
}

export const DEFAULT_FILTERS: DetectFilters = {
  pending: true,
  accepted: true,
  findings: false,
  rejected: false,
  allSurveys: false,
  hiddenTypes: new Set(),
};

export interface SurveyMap {
  id: string;
  name: string;
  date: string;
  basisRunId: string | null;
}

/** The survey dates one pane's map shows (spec §5.2 date scoping). */
export function sideDates(v: { mode: string; l: string | null; r: string | null }, side: MapSide): string[] {
  const one = (d: string | null) => (d ? [d] : []);
  if (side === "left") return one(v.l);
  if (side === "right" || v.mode === "single") return one(v.r);
  return [...new Set([...one(v.l), ...one(v.r)])];
}

/** The maps of those dates (or every flown survey), newest first, from W1's `surveys`. */
export function surveyMaps(surveys: readonly Survey[], dates: string[], allSurveys: boolean): SurveyMap[] {
  return surveys
    .filter((s) => !s.planned && (allSurveys || dates.includes(s.date)))
    .sort((a, b) => b.date.localeCompare(a.date))
    .flatMap((s) =>
      s.maps.map((m) => ({
        id: m.id,
        name: m.name,
        date: s.date,
        basisRunId: m.basis_run_id ?? null,
      })),
    )
    .slice(0, MAX_SURVEY_MAPS);
}

/** The survey basis run (else pinned, else newest succeeded whole-map run) plus succeeded region runs. */
export function shownRuns(runs: MapRun[], basisRunId: string | null): MapRun[] {
  const done = runs.filter((r) => r.state === "succeeded");
  const whole = done.filter((r) => r.scope !== "region");
  const basis =
    whole.find((r) => r.id === basisRunId) ??
    whole.find((r) => r.pinned) ??
    [...whole].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const regions = done.filter((r) => r.scope === "region");
  return basis ? [basis, ...regions] : regions;
}

export const detectionSelection = (runId: string, detectionId: string): Selection => ({
  kind: "detection",
  id: `${runId}.${detectionId}`,
});

export function parseDetectionId(id: string): { runId: string; detectionId: string } | null {
  const i = id.indexOf(".");
  return i > 0 && i < id.length - 1 ? { runId: id.slice(0, i), detectionId: id.slice(i + 1) } : null;
}

export type Look =
  "hidden" | "selected" | "object" | "object-accepted" | "pending-defect" | "accepted-defect" | "rejected";

export const isPending = (d: { review_state: string }): boolean => d.review_state === "unreviewed";

export function lookOf(
  d: { review_state: string; class_id: string },
  kind: "defect" | "object" | undefined,
  f: DetectFilters,
  selected: boolean,
): Look {
  if (f.hiddenTypes.has(d.class_id)) return "hidden";
  if (selected) return "selected";
  if (d.review_state === "rejected") return f.rejected ? "rejected" : "hidden";
  const pending = isPending(d);
  if (pending && !f.pending) return "hidden";
  if (kind === "defect") return pending ? "pending-defect" : f.findings ? "accepted-defect" : "hidden";
  if (pending) return "object";
  return f.accepted ? "object-accepted" : "hidden";
}

export function boxCentre(corners: number[][]): [number, number] {
  const n = corners.length;
  return [corners.reduce((a, c) => a + c[0], 0) / n, corners.reduce((a, c) => a + c[1], 0) / n];
}

export function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}
