import type { Survey } from "../types";

/** YYYY-MM-DD, the wire format of a survey date (spec §14); the one date regex, imported where needed (D3). */
export const SURVEY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The dates the timeline can select: flown surveys only, one per date, oldest first (spec §14). */
export function flownDates(surveys: readonly Survey[]): string[] {
  return [...new Set(surveys.filter((s) => !s.planned).map((s) => s.date))].sort();
}

export function canCompare(surveys: readonly Survey[]): boolean {
  return flownDates(surveys).length >= 2;
}

/** The next (dir 1) or previous (dir −1) date after `r`; null at an end or when it would not stay above `floor`. */
export function stepSurvey(
  dates: readonly string[],
  r: string | null,
  dir: 1 | -1,
  floor: string | null,
): string | null {
  if (dates.length === 0) return null;
  const at = r === null ? -1 : dates.indexOf(r);
  const next = at === -1 ? (dir === 1 ? dates[0] : dates[dates.length - 1]) : dates[at + dir];
  if (next === undefined) return null;
  if (floor !== null && next <= floor) return null;
  return next;
}
