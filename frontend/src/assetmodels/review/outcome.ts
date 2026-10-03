// src/assetmodels/review/outcome.ts
// Photo outcomes (spec §5.4 image_review.status) as camera glyph colours. The colours are the
// theme's status tokens, read at runtime and passed on as data (DESIGN.md: no raw colours).
import type { CameraPose } from "@/assetmodels/viewer/cameras";
import { tokenRgb } from "@/clouds/viewer/overlay";

export type OutcomeKey = "finding" | "uncertain" | "none" | "not_assessed" | "unreviewed";
export const OUTCOME_KEYS: readonly OutcomeKey[] = [
  "finding",
  "uncertain",
  "none",
  "not_assessed",
  "unreviewed",
];

export const OUTCOME_LABEL: Record<OutcomeKey, string> = {
  finding: "Finding",
  uncertain: "Uncertain",
  none: "No finding",
  not_assessed: "Not assessed",
  unreviewed: "Not reviewed",
};

const TOKEN: Record<OutcomeKey, string> = {
  finding: "danger",
  uncertain: "warn",
  none: "ok",
  not_assessed: "dim",
  unreviewed: "muted",
};

export function outcomeKey(o: string | null): OutcomeKey {
  return o === "finding" || o === "uncertain" || o === "none" || o === "not_assessed" ? o : "unreviewed";
}

/** A context photo shows the asset but holds no finding to look at. */
export function isContext(o: string | null): boolean {
  const k = outcomeKey(o);
  return k !== "finding" && k !== "uncertain";
}

export function outcomeColours(
  read: (token: string) => [number, number, number] = (t) => tokenRgb(t),
): Record<OutcomeKey, string> {
  const out = {} as Record<OutcomeKey, string>;
  for (const k of OUTCOME_KEYS) {
    const [r, g, b] = read(TOKEN[k]);
    out[k] = `rgb(${r}, ${g}, ${b})`;
  }
  return out;
}

export function filterPoses(
  poses: readonly CameraPose[],
  f: { sequence: string | null; includeContext: boolean },
): CameraPose[] {
  return poses.filter(
    (p) => (f.sequence === null || p.sequence === f.sequence) && (f.includeContext || !isContext(p.outcome)),
  );
}

export function outcomeCounts(poses: readonly CameraPose[]): Record<OutcomeKey, number> {
  const out: Record<OutcomeKey, number> = {
    finding: 0,
    uncertain: 0,
    none: 0,
    not_assessed: 0,
    unreviewed: 0,
  };
  for (const p of poses) out[outcomeKey(p.outcome)] += 1;
  return out;
}

export function sequencesOf(poses: readonly CameraPose[]): string[] {
  return [...new Set(poses.map((p) => p.sequence).filter((s): s is string => !!s))].sort();
}
