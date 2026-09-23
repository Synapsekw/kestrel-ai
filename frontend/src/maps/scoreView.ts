import type { MapScore } from "@contract/client";
import type { Match } from "./runLayer";

type Kind = "detection" | "label";

/** A lookup from box id to its score match, scoped to one feature kind (a detection's id and a
 * label's id can collide only in theory, but the two layers are always queried separately). */
export function matchLookup(
  score: MapScore | null,
  kind: Kind,
): ((id: string) => Match | undefined) | undefined {
  if (!score) return undefined;
  const byId = new Map(score.matches.filter((m) => m.kind === kind).map((m) => [m.id, m.match as Match]));
  return (id) => byId.get(id);
}

/** False positives and false negatives, in reading order (zone, then top to bottom, then left to
 * right), so stepping through them visits the map in a predictable sweep. */
export function mistakes(score: MapScore): MapScore["matches"] {
  return score.matches
    .filter((m) => m.match !== "tp")
    .sort((a, b) => a.zone_id.localeCompare(b.zone_id) || a.y - b.y || a.x - b.x);
}

export function pct(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(1)} %`;
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0";
}
