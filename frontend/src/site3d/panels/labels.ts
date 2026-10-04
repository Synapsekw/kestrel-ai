/** Plain, sentence-case words for the enum values the panels show (copy is sentence case, never raw codes). */

const CONFIDENCE: Record<string, string> = { high: "High", medium: "Medium", low: "Low" };
const PACKAGE_STATE: Record<string, string> = {
  queued: "Waiting",
  running: "Running",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped",
};

/** An unknown code still reads as words: "some_state" becomes "Some state". */
function sentence(code: string): string {
  const t = code.replace(/_/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** An item's confidence (`AssetItem.confidence`). */
export function confidenceLabel(c: string): string {
  return CONFIDENCE[c] ?? sentence(c);
}

/** A work package's state (`SiteModelPackage.state`). */
export function packageStateLabel(s: string): string {
  return PACKAGE_STATE[s] ?? sentence(s);
}
