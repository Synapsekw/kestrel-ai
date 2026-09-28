import type { Surface, VolumeMeasurement, components } from "@contract/client";
import { formatSurveyDate } from "@/mapws/w4host";

type VolumeBase = components["schemas"]["VolumeBase"];
export type CardId = "lowest" | "plane" | "design" | "earlier";

export interface BaseCard {
  id: CardId;
  title: string;
  sub: string;
  /** What a click saves; null when the card is disabled. */
  base: VolumeBase | null;
  disabledReason: string | null;
  selected: boolean;
  /** The design card's choice when the project has several designs. */
  options: { id: string; label: string }[];
}

/** "14 Sep 2026" (the timeline's date format, ruling T3-1: reuse W1's formatter). */
export function longDate(iso: string | null | undefined): string {
  return formatSurveyDate(iso ?? null);
}

/** A measured survey surface: a DSM from a cloud, or an imported DSM/DTM. */
export function isDsmLike(s: Surface): boolean {
  return s.kind === "cloud_dsm" || s.kind === "dem";
}

const rank = (s: Surface) => (s.kind === "cloud_dsm" ? 0 : 1);

/** A base must pair with the top: both georeferenced or both local (the server's invalid_base rule). */
function pairs(top: Surface) {
  return (s: Surface) =>
    s.id !== top.id && s.status === "ready" && (s.crs_wkt == null) === (top.crs_wkt == null);
}

function earlierSurvey(candidates: Surface[], top: Surface, l: string | null): Surface | "no_date" | null {
  const dsms = candidates.filter(isDsmLike);
  if (l && l !== top.captured_on) {
    const onL = dsms.filter((s) => s.captured_on === l).sort((a, b) => rank(a) - rank(b));
    if (onL[0]) return onL[0];
  }
  if (!top.captured_on) return "no_date";
  const before = dsms
    .filter((s) => s.captured_on != null && s.captured_on < top.captured_on!)
    .sort((a, b) => b.captured_on!.localeCompare(a.captured_on!) || rank(a) - rank(b));
  return before[0] ?? null;
}

/** The four base cards of the volume inspector (spec §10), with why a card is off. */
export function baseCards(input: {
  measurement: VolumeMeasurement;
  top: Surface;
  surfaces: Surface[];
  l: string | null;
}): BaseCard[] {
  const { measurement: m, top, surfaces, l } = input;
  const candidates = surfaces.filter(pairs(top));
  const designs = candidates.filter((s) => s.kind === "design").sort((a, b) => a.name.localeCompare(b.name));
  const storedId = m.base.kind === "surface" ? (m.base.surface_id ?? null) : null;
  const design = designs.find((s) => s.id === storedId) ?? designs[0] ?? null;
  const earlier = earlierSurvey(candidates, top, l);
  const earlierSurface = earlier && earlier !== "no_date" ? earlier : null;
  const storedIsDesign = designs.some((s) => s.id === storedId);

  return [
    {
      id: "lowest",
      title: "Lowest point",
      sub: "flat at toe min",
      base: { kind: "toe_lowest" },
      disabledReason: null,
      selected: m.base.kind === "toe_lowest",
      options: [],
    },
    {
      id: "plane",
      title: "Best-fit plane",
      sub: "through toe vertices",
      base: { kind: "toe_plane" },
      disabledReason: null,
      selected: m.base.kind === "toe_plane",
      options: [],
    },
    {
      id: "design",
      title: "Design DTM",
      sub: design?.name ?? "no design",
      base: design ? { kind: "surface", surface_id: design.id } : null,
      disabledReason: design ? null : "No design surface — import one from Add data",
      selected: m.base.kind === "surface" && storedIsDesign,
      options: designs.length > 1 ? designs.map((s) => ({ id: s.id, label: s.name })) : [],
    },
    {
      id: "earlier",
      title: "Earlier survey",
      sub: earlierSurface
        ? `${earlierSurface.kind === "dem" && earlierSurface.elevation_role === "dtm" ? "DTM" : "DSM"} ${longDate(earlierSurface.captured_on)}`
        : "no earlier survey",
      base: earlierSurface ? { kind: "surface", surface_id: earlierSurface.id } : null,
      disabledReason: earlierSurface
        ? null
        : earlier === "no_date"
          ? "The top surface has no survey date"
          : "No earlier survey with a DSM",
      selected: m.base.kind === "surface" && storedId !== null && !storedIsDesign,
      options: [],
    },
  ];
}

export function selectedCard(cards: BaseCard[]): CardId | null {
  return cards.find((c) => c.selected)?.id ?? null;
}
