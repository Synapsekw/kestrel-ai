/**
 * Fixed words for a failed file load (a GLB, a point cloud). The loaders' own messages name the URL
 * they fetched, and those URLs carry `?token=` (three's FileLoader: `fetch for "<url>" responded with
 * 404: Not Found`), so a loader message never reaches the UI or a log. Only the HTTP status survives.
 */
export function loadFailureText(lead: string, err: unknown): string {
  const status = httpStatusOf(err);
  return status !== null ? `${lead} (HTTP ${status}).` : `${lead}.`;
}

/** The HTTP status of a failed fetch, from the error's response or its message's digits; never its text. */
export function httpStatusOf(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as { response?: { status?: unknown }; status?: unknown; message?: unknown };
  const direct = typeof e.response?.status === "number" ? e.response.status : e.status;
  if (typeof direct === "number" && direct >= 100 && direct <= 599) return direct;
  if (typeof e.message !== "string") return null;
  const m = /\b(?:HTTP|status|responded with)\s*(\d{3})\b/i.exec(e.message);
  return m ? Number(m[1]) : null;
}
