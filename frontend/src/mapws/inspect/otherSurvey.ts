/**
 * The survey to show a finding on instead of its own: the one before, else the next; null if none.
 * F8: kept out of FindingBody.tsx (a sibling non-component module) so react-refresh does not warn
 * about that file exporting a non-component alongside its components.
 */
export function otherSurvey(dates: readonly string[], anchor: string | null): string | null {
  if (anchor === null) return null;
  const at = dates.indexOf(anchor);
  if (at > 0) return dates[at - 1];
  return dates.find((d) => d !== anchor) ?? null;
}
