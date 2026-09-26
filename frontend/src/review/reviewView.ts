export type ReviewView = "suggestions" | "runs";

/**
 * Which review `/review` shows (spec 2026-09-26-foundation section 6.2: both, for any project):
 * a run's `?ids=` always narrows the image queue; `?view=` picks; a `?source=` link means runs.
 */
export function reviewView(params: URLSearchParams): ReviewView {
  if (params.get("ids")) return "suggestions";
  const view = params.get("view");
  if (view === "runs" || view === "suggestions") return view;
  return params.get("source") ? "runs" : "suggestions";
}
