import type { ReportListItem, ReportVersion } from "@/api/reports";
import { ApiFailure, messageOf } from "@/api/errors";

// A fixed 3-letter month abbreviation, not `Intl`'s "short" month: CLDR has shipped "Sept" for
// September's short form in some ICU versions, which would make this depend on the runtime's ICU
// data rather than being stable across environments.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "24 Sep", in UTC (the backend's stamps); empty for a missing or unparsable value. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "v3"; empty while a render has no number yet (R5 allocates it on promote). */
export function versionName(n: number | null | undefined): string {
  return typeof n === "number" ? `v${n}` : "";
}

type LastVersion = NonNullable<ReportListItem["last_version"]>;

/** The list card's version line (spec §12): "Issued v3 · 24 Sep", "Draft v2", "Rendering…". */
export function lastVersionLine(v: LastVersion | null | undefined): string {
  if (!v) return "No versions yet";
  if (v.state === "rendering") return "Rendering…";
  if (v.state === "failed") return "Render failed";
  const name = versionName(v.number);
  return v.issued_at ? `Issued ${name} · ${shortDate(v.issued_at)}` : `Draft ${name}`;
}

export function pagesLabel(pages: number | null | undefined): string {
  if (typeof pages !== "number") return "";
  return pages === 1 ? "1 page" : `${pages} pages`;
}

/** A version's pages: `stats.page_count`, else the sum over its PDF files. */
export function versionPages(v: ReportVersion): number | null {
  if (typeof v.stats?.page_count === "number") return v.stats.page_count;
  const pdfs = v.files.filter((f) => f.kind === "pdf" && typeof f.pages === "number");
  return pdfs.length ? pdfs.reduce((n, f) => n + (f.pages ?? 0), 0) : null;
}

export function versionParts(v: ReportVersion): number {
  if (typeof v.stats?.part_count === "number") return v.stats.part_count;
  return Math.max(1, v.files.filter((f) => f.kind === "pdf").length);
}

/** A failed render's message (R5 writes `stats.error`). */
export function versionError(v: ReportVersion): string | null {
  const e = v.stats?.error;
  return typeof e === "string" && e ? e : null;
}

/** The filters' live count line (spec §12: "38 findings match"). */
export function matchLine(count: number | null): string {
  if (count === null) return "Counting findings…";
  if (count === 0) return "No findings match";
  return count === 1 ? "1 finding matches" : `${count.toLocaleString("en-GB")} findings match`;
}

/** R1's 422 `invalid_report` carries `details.errors[{path, message}]`; name each field. */
export function saveErrorText(err: unknown): string {
  const errors = err instanceof ApiFailure ? err.details.errors : undefined;
  if (Array.isArray(errors) && errors.length > 0) {
    return errors
      .map((e: { path?: unknown; message?: unknown }) =>
        typeof e.path === "string" ? `${e.path}: ${String(e.message ?? "")}` : String(e.message ?? ""),
      )
      .join("; ");
  }
  return messageOf(err, "could not save the report");
}
