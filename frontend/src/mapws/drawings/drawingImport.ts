import type { LinearUnit } from "@/api/designSurfaces";
import type { DrawingCreate, DrawingFormat, DrawingInspection, DrawingPage } from "@/api/drawings";
import type { SegmentedOption } from "@/ui";

export type DrawingFamily = "vector" | "pdf" | "raster";
export type PlacementKind = "crs" | "embedded" | "none";

export const DPI_CHOICES = [100, 150, 200, 300] as const;
export type DpiChoice = (typeof DPI_CHOICES)[number];
export const DEFAULT_DPI: DpiChoice = 150;
export const MAX_SIDE_PX = 20_000;
export const MAX_PIXELS = 300_000_000;

/** `DrawingCreate.name` is capped at 200 chars (openapi.yaml `maxLength: 200`, PF12a). */
const MAX_NAME_LENGTH = 200;

export function familyOf(format: DrawingFormat): DrawingFamily {
  if (format === "dxf" || format === "landxml") return "vector";
  if (format === "pdf") return "pdf";
  return "raster";
}

type PageSize = Pick<DrawingPage, "width_pt" | "height_pt">;

export function renderSize(page: PageSize, dpi: number): { width: number; height: number } {
  return {
    width: Math.round((page.width_pt / 72) * dpi),
    height: Math.round((page.height_pt / 72) * dpi),
  };
}

/**
 * A ported copy of the server's `_fits` (`backend/app/drawings/pdf.py:38-41`): whether a render at
 * `dpi` stays within `MAX_SIDE_PX` on a side and `MAX_PIXELS` overall.
 */
function fitsAt(page: PageSize, dpi: number): boolean {
  const width = Math.ceil((page.width_pt * dpi) / 72);
  const height = Math.ceil((page.height_pt * dpi) / 72);
  return Math.max(width, height) <= MAX_SIDE_PX && width * height <= MAX_PIXELS;
}

/**
 * A ported copy of the server's `max_dpi` (`pdf.py:43-48`): the largest whole DPI that fits, found
 * by the same ceil-then-decrement search so the two never disagree on an edge case.
 */
function maxDpi(page: PageSize): number {
  const { width_pt: w, height_pt: h } = page;
  let d = Math.floor(Math.min((MAX_SIDE_PX * 72) / Math.max(w, h), Math.sqrt(MAX_PIXELS / (w * h)) * 72));
  while (d > 1 && !fitsAt(page, d)) d -= 1;
  return Math.max(d, 1);
}

/**
 * The DPI to send (an allowed value) and the DPI the page will really render at. Preflight
 * adaptation PF16: `renderDpi` ports the server's `_fits`/`max_dpi` (ceil + decrement,
 * `pdf.py:38-52`) so the dialog's "renders at N dpi" equals `effective_dpi` in
 * `backend/app/drawings/placement.py:41`, which the server actually uses.
 */
export function fitDpi(
  page: PageSize,
  wanted: DpiChoice,
): { dpi: DpiChoice; renderDpi: number; lowered: boolean } {
  const cap = maxDpi(page);
  const dpi = [...DPI_CHOICES].reverse().find((d) => d <= wanted && d <= cap) ?? DPI_CHOICES[0];
  const renderDpi = Math.min(dpi, cap);
  return { dpi, renderDpi, lowered: renderDpi < wanted };
}

/** M-C0's `crs_hint` is a CRS name; an EPSG code inside it prefills the field (deviation 6). */
export function epsgFromHint(hint: string | null): number | null {
  const m = hint ? /EPSG\D{0,3}(\d{4,6})/i.exec(hint) : null;
  return m ? Number(m[1]) : null;
}

/** What the operator chose; `name: null` follows the default name. */
export interface DrawingForm {
  /** Page shown in the DPI preview. */
  page: number;
  /** PDF pages to import. One entry for any other file. */
  pages: number[];
  dpi: DpiChoice;
  placement: PlacementKind;
  epsg: string;
  units: LinearUnit | null;
  layers: string[];
  name: string | null;
}

export function initialDrawingForm(insp: DrawingInspection): DrawingForm {
  const family = familyOf(insp.format);
  const epsg = epsgFromHint(insp.crs_hint) ?? insp.embedded?.epsg ?? null;
  const placement: PlacementKind =
    family === "vector"
      ? epsg
        ? "crs"
        : "none"
      : family === "raster" && insp.embedded
        ? "embedded"
        : "none";
  return {
    page: 1,
    pages: [1],
    dpi: DEFAULT_DPI,
    placement,
    epsg: epsg ? String(epsg) : "",
    units: family === "vector" ? (insp.units ?? "metre") : null,
    layers: insp.layers.filter((l) => l.visible_default && l.entity_count > 0).map((l) => l.name),
    name: null,
  };
}

export function placementChoices(insp: DrawingInspection): SegmentedOption<PlacementKind>[] {
  const none: SegmentedOption<PlacementKind> = {
    value: "none",
    label: "Place with control points",
  };
  const family = familyOf(insp.format);
  if (family === "vector") return [{ value: "crs", label: "Coordinates (EPSG)" }, none];
  if (family === "raster" && insp.embedded)
    return [
      {
        value: "embedded",
        label: insp.embedded.source === "world_file" ? "World file" : "GeoTIFF coordinates",
      },
      none,
    ];
  return [none];
}

function stem(path: string): string {
  return (path.split(/[\\/]/).pop() ?? "").replace(/\.[^.]+$/, "");
}

export function defaultDrawingName(insp: DrawingInspection, page: number): string {
  // The stem gives way, so a capped name keeps its " · pN" page suffix.
  const suffix = familyOf(insp.format) === "pdf" && (insp.page_count ?? 0) > 1 ? ` · p${page}` : "";
  return stem(insp.path).slice(0, MAX_NAME_LENGTH - suffix.length) + suffix;
}

/** The name field. Several selected pages share the file stem; each request adds its own page suffix. */
export function drawingNameField(insp: DrawingInspection, f: DrawingForm): string {
  if (f.name != null) return f.name;
  const pages = chosenPages(f.pages);
  if (familyOf(insp.format) === "pdf" && pages.length > 1) return stem(insp.path);
  return defaultDrawingName(insp, pages[0] ?? f.page);
}

function chosenPages(pages: readonly number[]): number[] {
  return [...new Set(pages.filter((p) => Number.isInteger(p)))].sort((a, b) => a - b);
}

/** Every page of a PDF, including pages past the 50 thumbnails. */
export function allPdfPages(insp: DrawingInspection): number[] {
  const count = insp.page_count ?? insp.pages.length;
  return Array.from({ length: Math.max(0, count) }, (_, i) => i + 1);
}

const PAGE_SUFFIX = / · p\d+$/;

function withPageSuffix(name: string, page: number): string {
  const suffix = ` · p${page}`;
  const base = name.trim().replace(PAGE_SUFFIX, "");
  if (!base) return "";
  return base.slice(0, MAX_NAME_LENGTH - suffix.length) + suffix;
}

function parseEpsg(s: string): number | null {
  return /^\d{4,6}$/.test(s.trim()) ? Number(s.trim()) : null;
}

export type DrawingRequest = { ok: true; body: DrawingCreate } | { ok: false; error: string };

export function toDrawingRequest(insp: DrawingInspection, f: DrawingForm): DrawingRequest {
  const family = familyOf(insp.format);
  const name = (f.name ?? defaultDrawingName(insp, f.page)).trim();
  if (!name) return { ok: false, error: "Give the drawing a name." };
  if (name.length > MAX_NAME_LENGTH) return { ok: false, error: "Keep the name under 200 characters." };
  const body: DrawingCreate = {
    inspection_id: insp.id,
    name,
    placement: { method: "none" },
  };

  if (family === "pdf") {
    const count = insp.page_count ?? insp.pages.length;
    if (!Number.isInteger(f.page) || f.page < 1 || f.page > count)
      return { ok: false, error: `Choose a page between 1 and ${count}.` };
    const size = insp.pages.find((p) => p.page === f.page);
    body.page = f.page;
    // Past the 50 listed pages the size is unknown here; the server lowers the DPI itself.
    body.dpi = size ? fitDpi(size, f.dpi).dpi : f.dpi;
  }
  if (family === "vector") {
    if (f.layers.length === 0) return { ok: false, error: "Choose at least one layer to import." };
    body.layers = f.layers;
    if (f.placement === "crs") {
      const epsg = parseEpsg(f.epsg);
      if (epsg === null) return { ok: false, error: "Enter an EPSG code such as 32638." };
      body.placement = {
        method: "crs",
        crs: `EPSG:${epsg}`,
        units: f.units ?? "metre",
      };
    }
  }
  if (family === "raster" && f.placement === "embedded" && insp.embedded) {
    if (insp.embedded.needs_crs) {
      const epsg = parseEpsg(f.epsg);
      if (epsg === null)
        return {
          ok: false,
          error: "A world file has no CRS: enter the EPSG code of its coordinates, such as 32638.",
        };
      body.placement = { method: "embedded", crs: `EPSG:${epsg}` };
    } else body.placement = { method: "embedded" };
  }
  return { ok: true, body };
}

/**
 * One build request per selected PDF page (each page is its own drawing). Other files stay one
 * request. A custom name shared by several pages gains a ` · pN` suffix so the drawings stay distinct.
 */
export function toDrawingRequests(
  insp: DrawingInspection,
  f: DrawingForm,
): { ok: true; bodies: DrawingCreate[] } | { ok: false; error: string } {
  if (familyOf(insp.format) !== "pdf") {
    const one = toDrawingRequest(insp, f);
    return one.ok ? { ok: true, bodies: [one.body] } : one;
  }
  const pages = chosenPages(f.pages);
  if (pages.length === 0) return { ok: false, error: "Choose at least one page." };
  const bodies: DrawingCreate[] = [];
  for (const page of pages) {
    const named =
      pages.length > 1 && f.name != null
        ? { ...f, page, name: withPageSuffix(f.name, page) }
        : { ...f, page };
    const one = toDrawingRequest(insp, named);
    if (!one.ok) return one;
    bodies.push(one.body);
  }
  return { ok: true, bodies };
}
