import type {
  DesignCandidate,
  DesignImportOptions,
  DesignInspection,
  DesignPreview,
  DesignWarning,
  LinearUnit,
  Surface,
} from "@/api/designSurfaces";

export const UNIT_OPTIONS: { value: LinearUnit; label: string }[] = [
  { value: "metre", label: "Metre" },
  { value: "millimetre", label: "Millimetre" },
  { value: "centimetre", label: "Centimetre" },
  { value: "us_survey_foot", label: "US survey foot (1200/3937 m)" },
  { value: "international_foot", label: "International foot (0.3048 m)" },
];

/** The dialog's options as typed; strings for the numeric inputs so partial input is kept. */
export interface ImportForm {
  candidateIds: string[];
  sourceCrs: string;
  horizontalUnit: LinearUnit | "";
  verticalUnit: LinearUnit | "";
  swapXy: boolean;
  /** "" = no target. */
  targetSurfaceId: string;
  cellSizeM: string;
  /** "" = automatic, "0" = off. */
  maxEdgeM: string;
}

export interface ImportGate {
  allowed: boolean;
  needsAccept: boolean;
  reason: string | null;
}

export function blockedNote(c: DesignCandidate): DesignWarning | undefined {
  return c.notes.find((n) => n.level === "block");
}

function crsLabel(epsg: number | null | undefined, wkt: string | null | undefined): string {
  return epsg ? `EPSG:${epsg}` : (wkt ?? "");
}

export function initialForm(insp: DesignInspection, targets: Surface[]): ImportForm {
  const d = insp.detected;
  const usable = insp.candidates.filter((c) => c.default_selected && !blockedNote(c)).map((c) => c.id);
  const candidateIds = insp.format === "dxf" ? usable : usable.slice(0, 1);
  const target = targets.find((t) => t.id === insp.default_target_surface_id);
  const fromFile = crsLabel(d?.epsg, d?.crs_wkt);
  return {
    candidateIds,
    sourceCrs: fromFile || (target ? crsLabel(target.epsg, target.crs_wkt) : ""),
    horizontalUnit: insp.format === "geotiff" ? "metre" : (d?.horizontal_unit ?? ""),
    verticalUnit: d?.vertical_unit ?? d?.horizontal_unit ?? "",
    swapXy: false,
    targetSurfaceId: target ? target.id : "",
    cellSizeM: "0.25",
    maxEdgeM: "",
  };
}

export function crsHint(insp: DesignInspection, form: ImportForm, targets: Surface[]): string {
  const d = insp.detected;
  const says = d?.crs_hint ? ` The file says: ${d.crs_hint}` : "";
  if (d && (d.epsg || d.crs_wkt) && form.sourceCrs === crsLabel(d.epsg, d.crs_wkt)) {
    return `From the file: ${d.crs_source ?? "its CRS"}`;
  }
  const target = targets.find((t) => t.id === form.targetSurfaceId);
  if (target && form.sourceCrs === crsLabel(target.epsg, target.crs_wkt)) {
    return `Assumed from the cloud surface — confirm it.${says}`;
  }
  return `Enter the CRS the design was drawn in, as EPSG:<code> or WKT.${says}`;
}

export function pointsSelected(insp: DesignInspection, form: ImportForm): boolean {
  return insp.candidates.some((c) => form.candidateIds.includes(c.id) && c.geometry === "points");
}

export function toRequest(
  form: ImportForm,
): { ok: true; body: DesignImportOptions } | { ok: false; error: string } {
  if (form.candidateIds.length === 0) return { ok: false, error: "Choose what to import." };
  if (!form.sourceCrs.trim()) {
    return { ok: false, error: "Enter the CRS the design was drawn in, for example EPSG:32639." };
  }
  if (!form.horizontalUnit || !form.verticalUnit)
    return { ok: false, error: "Choose the horizontal and height units." };
  const body: DesignImportOptions = {
    candidate_ids: form.candidateIds,
    source_crs: form.sourceCrs.trim(),
    horizontal_unit: form.horizontalUnit,
    vertical_unit: form.verticalUnit,
    swap_xy: form.swapXy,
    target_surface_id: form.targetSurfaceId || null,
  };
  if (!form.targetSurfaceId) {
    const cell = Number(form.cellSizeM);
    if (!(cell > 0)) return { ok: false, error: "Enter a cell size in metres." };
    body.cell_size_m = cell;
  }
  if (form.maxEdgeM.trim()) {
    const m = Number(form.maxEdgeM);
    if (!(m >= 0))
      return { ok: false, error: "The maximum edge length is a number of metres (0 turns trimming off)." };
    body.max_edge_m = m;
  }
  return { ok: true, body };
}

export function formKey(form: ImportForm): string {
  const r = toRequest(form);
  return r.ok ? JSON.stringify(r.body) : "";
}

export function isStale(
  form: ImportForm,
  preview: DesignPreview | null,
  previewedKey: string | null,
): boolean {
  return preview !== null && formKey(form) !== previewedKey;
}

export function applyPatch(form: ImportForm, patch: Record<string, unknown>): ImportForm {
  const next = { ...form };
  if (typeof patch.swap_xy === "boolean") next.swapXy = patch.swap_xy;
  if (typeof patch.horizontal_unit === "string") next.horizontalUnit = patch.horizontal_unit as LinearUnit;
  if (typeof patch.vertical_unit === "string") next.verticalUnit = patch.vertical_unit as LinearUnit;
  if (typeof patch.source_crs === "string") next.sourceCrs = patch.source_crs;
  return next;
}

export function importGate(preview: DesignPreview | null, stale: boolean, accepted: boolean): ImportGate {
  if (!preview || preview.state === "running") {
    return { allowed: false, needsAccept: false, reason: "Preview the design first." };
  }
  if (preview.state === "failed") {
    return {
      allowed: false,
      needsAccept: false,
      reason: preview.error ?? "The preview failed; preview again.",
    };
  }
  if (stale)
    return {
      allowed: false,
      needsAccept: false,
      reason: "The options changed since the preview — preview again.",
    };
  const block = preview.warnings.find((w) => w.level === "block");
  if (block)
    return { allowed: false, needsAccept: false, reason: `This design can't be imported: ${block.message}` };
  const needsAccept = preview.warnings.some((w) => w.level === "warn");
  if (needsAccept && !accepted) {
    return { allowed: false, needsAccept, reason: "Tick “Import despite these warnings” to import." };
  }
  return { allowed: true, needsAccept, reason: null };
}

export function defaultName(insp: DesignInspection, form: ImportForm): string {
  const stem = (insp.path.split(/[\\/]/).pop() ?? insp.path).replace(/\.[^.]+$/, "");
  const names = insp.candidates.filter((c) => form.candidateIds.includes(c.id)).map((c) => c.name);
  return names.length && insp.format !== "geotiff" ? `${stem} — ${names.join(", ")}` : stem;
}

export function formatPct(x: number | null | undefined): string {
  return x === null || x === undefined ? "—" : `${(100 * x).toFixed(1)} %`;
}
