import type { Surface } from "@contract/client";
import type { ElevationImportRequest } from "@/api/elevations";

export type DemRole = "dsm" | "dtm";
/** Strings for the inputs so partial typing is kept; `alignTo: null` follows the default target. */
export interface DemForm {
  path: string;
  name: string | null;
  role: DemRole;
  capturedOn: string;
  alignTo: string | null;
  cellSize: string;
}
export type DemField = "path" | "name" | "capturedOn" | "cellSize";
export type DemRequest =
  { ok: true; body: ElevationImportRequest } | { ok: false; field: DemField; error: string };

/** `ElevationImportRequest.name` is capped at 200 chars (openapi.yaml `maxLength: 200`, PF12a). */
const MAX_NAME_LENGTH = 200;

export const ROLE_OPTIONS: { value: DemRole; label: string }[] = [
  { value: "dsm", label: "DSM — surface incl. objects" },
  { value: "dtm", label: "DTM — bare ground" },
];

/** Ready cloud DSMs and dem surfaces, newest survey first (R-W5-8). */
export function alignTargets(surfaces: readonly Surface[]): Surface[] {
  const day = (s: Surface) => s.captured_on ?? s.created_at.slice(0, 10);
  return surfaces
    .filter((s) => (s.kind === "cloud_dsm" || s.kind === "dem") && s.status === "ready")
    .sort((a, b) => day(b).localeCompare(day(a)) || b.created_at.localeCompare(a.created_at));
}

export function initialDemForm(): DemForm {
  return {
    path: "",
    name: null,
    role: "dsm",
    capturedOn: "",
    alignTo: null,
    cellSize: "",
  };
}

export function fileStem(path: string): string {
  const base = path.trim().split(/[\\/]/).pop() ?? "";
  return base.replace(/\.[^.]+$/, "").slice(0, MAX_NAME_LENGTH);
}

export function resolvedAlign(f: DemForm, targets: readonly Surface[]): string {
  return f.alignTo ?? targets[0]?.id ?? "";
}

export function toElevationRequest(f: DemForm, targets: readonly Surface[]): DemRequest {
  const path = f.path.trim();
  if (!path) return { ok: false, field: "path", error: "Choose the GeoTIFF to import." };
  if (!/\.tiff?$/i.test(path)) return { ok: false, field: "path", error: "Pick a .tif or .tiff file." };
  const name = (f.name ?? fileStem(path)).trim();
  if (!name) return { ok: false, field: "name", error: "Give the surface a name." };
  if (name.length > MAX_NAME_LENGTH)
    return { ok: false, field: "name", error: "Keep the name under 200 characters." };
  if (f.capturedOn && !/^\d{4}-\d{2}-\d{2}$/.test(f.capturedOn))
    return { ok: false, field: "capturedOn", error: "Use a date like 2026-09-14." };
  const body: ElevationImportRequest = { path, name, role: f.role };
  if (f.capturedOn) body.captured_on = f.capturedOn;
  const align = resolvedAlign(f, targets);
  if (align) body.align_to_surface_id = align;
  else if (f.cellSize.trim()) {
    const cell = Number(f.cellSize);
    if (!Number.isFinite(cell) || cell < 0.01 || cell > 5)
      return { ok: false, field: "cellSize", error: "The cell size is between 0.01 and 5 m." };
    body.cell_size_m = cell;
  }
  return { ok: true, body };
}
