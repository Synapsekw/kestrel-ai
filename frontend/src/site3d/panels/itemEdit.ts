import type { AssetSpec } from "@contract/client";
import type { AssetItem } from "@/api/plantItems";

export type FieldKind = "number" | "integer" | "boolean" | "enum" | "string" | "json";
export interface FieldSpec {
  key: string;
  label: string;
  unit?: string;
  kind: FieldKind;
  options?: string[];
  min?: number;
  exclusiveMin?: boolean;
  max?: number;
  nullable: boolean;
  defaultValue?: unknown;
  help?: string;
}

interface Schema {
  type?: string;
  enum?: unknown[];
  anyOf?: Schema[];
  $ref?: string;
  minimum?: number;
  exclusiveMinimum?: number;
  maximum?: number;
  default?: unknown;
  description?: string;
  properties?: Record<string, Schema>;
  $defs?: Record<string, Schema>;
}

const sentence = (s: string) => {
  const t = s.replace(/_/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** pydantic `model_json_schema()` → form fields (Ruling 15). Keys ending `_m` get a metre unit. */
export function fieldsFromSchema(schema: unknown): FieldSpec[] {
  const root = (schema ?? {}) as Schema;
  const defs = root.$defs ?? {};
  const deref = (s: Schema): Schema => (s.$ref ? (defs[s.$ref.split("/").pop() ?? ""] ?? {}) : s);
  return Object.entries(root.properties ?? {}).map(([key, raw]) => {
    let s = deref(raw);
    let nullable = false;
    if (s.anyOf) {
      const parts = s.anyOf.map(deref);
      nullable = parts.some((p) => p.type === "null");
      s = {
        ...(parts.find((p) => p.type !== "null") ?? {}),
        default: raw.default ?? s.default,
        description: raw.description ?? s.description,
      };
    }
    const kind: FieldKind = s.enum
      ? "enum"
      : s.type === "number"
        ? "number"
        : s.type === "integer"
          ? "integer"
          : s.type === "boolean"
            ? "boolean"
            : s.type === "string"
              ? "string"
              : "json";
    const metric = key.endsWith("_m");
    return {
      key,
      label: sentence(metric ? key.slice(0, -2) : key),
      ...(metric ? { unit: "m" } : {}),
      kind,
      ...(s.enum ? { options: s.enum.map(String) } : {}),
      ...(s.exclusiveMinimum !== undefined
        ? { min: s.exclusiveMinimum, exclusiveMin: true }
        : s.minimum !== undefined
          ? { min: s.minimum, exclusiveMin: false }
          : {}),
      ...(s.maximum !== undefined ? { max: s.maximum } : {}),
      nullable,
      defaultValue: raw.default ?? s.default,
      ...(s.description ? { help: s.description } : {}),
    };
  });
}

export type HeightSource = AssetItem["height_source"];
export interface ItemDraft {
  type: string;
  base_el: string;
  top_el: string;
  height_source: HeightSource;
  /** rect: e, n, along, across, rot · circle: e, n, d · line: width · polygon: none. */
  fp: Record<string, string>;
  params: Record<string, string | boolean>;
}

const str = (v: unknown) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
type Fp = {
  kind: string;
  center?: number[];
  size?: number[];
  rot_deg?: number;
  d?: number;
  pts?: number[][];
  width?: number;
};
const paramsOf = (item: AssetItem) => (item.params ?? {}) as Record<string, unknown>;

export function draftOf(item: AssetItem, fields: readonly FieldSpec[]): ItemDraft {
  const fp = item.footprint as unknown as Fp;
  const fpd: Record<string, string> =
    fp.kind === "rect"
      ? {
          e: str(fp.center![0]),
          n: str(fp.center![1]),
          along: str(fp.size![0]),
          across: str(fp.size![1]),
          rot: str(fp.rot_deg ?? 0),
        }
      : fp.kind === "circle"
        ? { e: str(fp.center![0]), n: str(fp.center![1]), d: str(fp.d) }
        : fp.kind === "line"
          ? { width: str(fp.width) }
          : {};
  const own = paramsOf(item);
  const params: Record<string, string | boolean> = {};
  for (const f of fields) {
    const v = own[f.key];
    params[f.key] = f.kind === "boolean" ? Boolean(v ?? f.defaultValue ?? false) : str(v);
  }
  return {
    type: item.type,
    base_el: str(item.base_el),
    top_el: str(item.top_el),
    height_source: item.height_source,
    fp: fpd,
    params,
  };
}

const num = (s: string): number | null => (s.trim() === "" ? null : Number(s));
const el = (s: string) => num(s);

/** Did the draft change base or top EL from the item's? */
export function elEdited(item: AssetItem, d: ItemDraft): boolean {
  return el(d.base_el) !== (item.base_el ?? null) || el(d.top_el) !== (item.top_el ?? null);
}

/**
 * The height source the save writes. An EL typed by hand over a scan or indicative height becomes a
 * drawing height, so the scan check (which rewrites only cloud and indicative heights) keeps it.
 */
export function effectiveHeightSource(item: AssetItem, d: ItemDraft): HeightSource {
  return item.height_source !== "drawing" && elEdited(item, d) ? "drawing" : d.height_source;
}

export function validateDraft(
  d: ItemDraft,
  fields: readonly FieldSpec[],
  footprintKind: string,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const base = num(d.base_el);
  const top = num(d.top_el);
  if (base !== null && !Number.isFinite(base)) errors.base_el = "Enter a number.";
  if (top !== null && !Number.isFinite(top)) errors.top_el = "Enter a number.";
  else if (base !== null && top !== null && Number.isFinite(base) && top < base)
    errors.top_el = "Top EL must be at or above base EL.";
  const positive =
    footprintKind === "rect"
      ? ["along", "across"]
      : footprintKind === "circle"
        ? ["d"]
        : footprintKind === "line"
          ? ["width"]
          : [];
  for (const [k, v] of Object.entries(d.fp)) {
    const n = num(v);
    if (n === null || !Number.isFinite(n)) errors[`fp.${k}`] = "Enter a number.";
    else if (positive.includes(k) && n <= 0) errors[`fp.${k}`] = "Must be more than 0.";
  }
  for (const f of fields) {
    const v = d.params[f.key];
    const at = `params.${f.key}`;
    if (v === undefined || typeof v === "boolean" || f.kind === "enum" || f.kind === "string") continue;
    if (v.trim() === "") continue; // empty = the builder's default
    if (f.kind === "json") {
      try {
        JSON.parse(v);
      } catch {
        errors[at] = "Enter valid JSON.";
      }
      continue;
    }
    const n = Number(v);
    if (!Number.isFinite(n)) errors[at] = "Enter a number.";
    else if (f.kind === "integer" && !Number.isInteger(n)) errors[at] = "Enter a whole number.";
    else if (f.min !== undefined && (f.exclusiveMin ? n <= f.min : n < f.min))
      errors[at] = f.exclusiveMin ? `Must be more than ${f.min}.` : `Must be ${f.min} or more.`;
    else if (f.max !== undefined && n > f.max) errors[at] = `Must be ${f.max} or less.`;
  }
  return errors;
}

export function applyDraft(item: AssetItem, d: ItemDraft, fields: readonly FieldSpec[]): AssetItem {
  const fp = item.footprint as unknown as Fp;
  const n = (s: string) => Number(s);
  const footprint =
    fp.kind === "rect"
      ? { ...fp, center: [n(d.fp.e), n(d.fp.n)], size: [n(d.fp.along), n(d.fp.across)], rot_deg: n(d.fp.rot) }
      : fp.kind === "circle"
        ? { ...fp, center: [n(d.fp.e), n(d.fp.n)], d: n(d.fp.d) }
        : fp.kind === "line"
          ? { ...fp, width: n(d.fp.width) }
          : fp;
  let params: Record<string, unknown> = {};
  if (d.type === item.type) {
    params = { ...paramsOf(item) };
    for (const f of fields) {
      const v = d.params[f.key];
      if (v === undefined) continue;
      if (typeof v === "boolean") {
        // A switch left at the builder's default on an item that never set it stays unset.
        if (!(f.key in paramsOf(item)) && v === Boolean(f.defaultValue ?? false)) continue;
        params[f.key] = v;
      } else if (v.trim() === "") delete params[f.key];
      else if (f.kind === "number" || f.kind === "integer") params[f.key] = Number(v);
      else if (f.kind === "json") params[f.key] = JSON.parse(v);
      else params[f.key] = v;
    }
  }
  const next = {
    ...item,
    type: d.type,
    base_el: el(d.base_el),
    top_el: el(d.top_el),
    height_source: effectiveHeightSource(item, d),
    footprint: footprint as AssetItem["footprint"],
    params,
  } as AssetItem;
  // An item that had no params and still has none keeps the field absent (a clean round trip).
  if (item.params === undefined && Object.keys(params).length === 0)
    delete (next as { params?: unknown }).params;
  return next;
}

export function sameDraft(a: ItemDraft, b: ItemDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The base spec with `item` replacing the item of the same id (never an add). */
export function withItem(spec: AssetSpec, item: AssetItem): AssetSpec {
  const items = ((spec as unknown as { items?: AssetItem[] }).items ?? []) as AssetItem[];
  const i = items.findIndex((x) => x.id === item.id);
  if (i < 0) throw new Error(`${item.tag ?? item.id} is not in this version.`);
  return { ...spec, items: items.map((x, k) => (k === i ? item : x)) } as AssetSpec;
}

const elText = (v: number | null | undefined) => (v == null ? "none" : `${v}`);

/** "Edited 20-T-0001 from v3: top EL 135 → 140 m" (at most 5 changes named). */
export function editNote(before: AssetItem, after: AssetItem, base: number): string {
  const changes: string[] = [];
  if (before.type !== after.type) changes.push(`type ${before.type} → ${after.type}`);
  if ((before.base_el ?? null) !== (after.base_el ?? null))
    changes.push(`base EL ${elText(before.base_el)} → ${elText(after.base_el)} m`);
  if ((before.top_el ?? null) !== (after.top_el ?? null))
    changes.push(`top EL ${elText(before.top_el)} → ${elText(after.top_el)} m`);
  if (before.height_source !== after.height_source)
    changes.push(`height source ${before.height_source} → ${after.height_source}`);
  if (JSON.stringify(before.footprint) !== JSON.stringify(after.footprint)) changes.push("footprint");
  if (JSON.stringify(before.params ?? {}) !== JSON.stringify(after.params ?? {})) changes.push("params");
  const shown = changes.length > 5 ? [...changes.slice(0, 5), `and ${changes.length - 5} more`] : changes;
  return `Edited ${before.tag ?? before.id} from v${base}: ${shown.join(", ") || "no changes"}`;
}
