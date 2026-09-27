import type { CompareMode, Selection } from "../types";
import { SURVEY_DATE_RE } from "./surveys";
import { COMPARE_MODES } from "./workspaceStore";

/** What the query string says about the view; absent keys mean "keep what you have". */
export interface UrlView {
  l?: string;
  r?: string;
  mode?: CompareMode;
  sel?: Selection | null;
}

/** `<kind>:<id>`, split at the first colon; the kind is lower-case letters and underscores. */
export function parseSelection(value: string | null): Selection | null {
  if (!value) return null;
  const at = value.indexOf(":");
  if (at <= 0 || at === value.length - 1) return null;
  const kind = value.slice(0, at);
  if (!/^[a-z_]+$/.test(kind)) return null;
  return { kind, id: value.slice(at + 1) };
}

export const formatSelection = (s: Selection): string => `${s.kind}:${s.id}`;

export function parseViewParams(p: URLSearchParams): UrlView {
  const out: UrlView = {};
  const l = p.get("l");
  const r = p.get("r");
  const mode = p.get("mode");
  if (l && SURVEY_DATE_RE.test(l)) out.l = l;
  if (r && SURVEY_DATE_RE.test(r)) out.r = r;
  if (mode && (COMPARE_MODES as readonly string[]).includes(mode)) out.mode = mode as CompareMode;
  if (p.has("sel")) out.sel = parseSelection(p.get("sel"));
  return out;
}

function put(p: URLSearchParams, key: string, value: string | null): void {
  if (value === null) p.delete(key);
  else p.set(key, value);
}

/** The view written into a copy of `current`; other params (map, finding, at, tool, …) stay. */
export function writeViewParams(
  current: URLSearchParams,
  v: {
    l: string | null;
    r: string | null;
    mode: CompareMode;
    selection: Selection | null;
  },
): URLSearchParams {
  const next = new URLSearchParams(current);
  put(next, "l", v.l);
  put(next, "r", v.r);
  put(next, "mode", v.mode === "single" ? null : v.mode);
  put(next, "sel", v.selection ? formatSelection(v.selection) : null);
  return next;
}
