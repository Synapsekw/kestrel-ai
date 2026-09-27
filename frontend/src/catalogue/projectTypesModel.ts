import type { ClassDef } from "@contract/client";
import type { CatalogueType, TypeKind } from "@/api/catalogue";
import { ApiFailure } from "@/api/errors";
import type { ProjectTypesUpdate } from "@/api/projectTypes";
import { normaliseName } from "./normaliseName";

export interface TypeRow {
  typeId: string;
  name: string;
  colour: string;
  kind: TypeKind;
  group: string | null;
  /** The catalogue's hotkey, or the project's own when the catalogue is unavailable. */
  catalogueHotkey: string | null;
  /** "" = use the catalogue's hotkey. */
  override: string;
}

export function effectiveHotkey(r: TypeRow): string | null {
  return r.override || r.catalogueHotkey;
}

/** `Project.classes` is derived from `project_type` (F §7.3): id = type id, order = position. */
export function rowsOf(classes: ClassDef[], catalogue: CatalogueType[]): TypeRow[] {
  return [...classes]
    .sort((a, b) => a.order - b.order)
    .map((c) => {
      const cat = catalogue.find((t) => t.id === c.id);
      const catalogueHotkey = cat ? (cat.hotkey ?? null) : (c.hotkey ?? null);
      const own = c.hotkey ?? null;
      return {
        typeId: c.id,
        name: c.name,
        colour: c.colour,
        kind: c.kind,
        group: c.group ?? null,
        catalogueHotkey,
        override: cat && own !== catalogueHotkey ? (own ?? "") : "",
      };
    });
}

export function addRow(rows: TypeRow[], t: CatalogueType): TypeRow[] {
  if (rows.some((r) => r.typeId === t.id)) return rows;
  return [
    ...rows,
    {
      typeId: t.id,
      name: t.name,
      colour: t.colour,
      kind: t.kind,
      group: t.group ?? null,
      catalogueHotkey: t.hotkey ?? null,
      override: "",
    },
  ];
}

export function moveRow(rows: TypeRow[], index: number, delta: number): TypeRow[] {
  const to = index + delta;
  if (to < 0 || to >= rows.length) return rows;
  const next = [...rows];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

export function removeRow(rows: TypeRow[], typeId: string): TypeRow[] {
  return rows.filter((r) => r.typeId !== typeId);
}

/** Hotkeys must be conflict-free within the project (F §7.2, 409 `hotkey_conflict`). */
export function hotkeyProblem(rows: TypeRow[]): string | null {
  const seen = new Map<string, TypeRow>();
  for (const r of rows) {
    const key = effectiveHotkey(r);
    if (!key) continue;
    const first = seen.get(key);
    if (first)
      return `Hotkey ${key.toUpperCase()} is used by "${first.name}" and "${r.name}" in this project.`;
    seen.set(key, r);
  }
  return null;
}

/**
 * `hotkeys[type_id]` is the override string, or `null` to clear one; a type id left out of the map
 * keeps whatever the project already has (the contract's `ProjectTypesUpdate.hotkeys`). The body is
 * a diff against `base`, the rows the edit started from: a set override is sent as its string, an
 * override that was set in `base` and is now empty is sent as `null` (so clearing one on the UI
 * clears it on the server), and an empty override that was already empty is left out. Without the
 * catalogue (503, or before its first answer) every row's override reads as empty, so leaving the
 * untouched ones out is what keeps a reorder from wiping the project's stored overrides.
 */
export function toTypesBody(rows: TypeRow[], base: TypeRow[]): ProjectTypesUpdate {
  const before = new Map(base.map((r) => [r.typeId, r.override]));
  const hotkeys: Record<string, string | null> = {};
  for (const r of rows) {
    if (r.override) hotkeys[r.typeId] = r.override;
    else if (before.get(r.typeId)) hotkeys[r.typeId] = null;
  }
  return { type_ids: rows.map((r) => r.typeId), hotkeys };
}

export function suggestions(query: string, catalogue: CatalogueType[], rows: TypeRow[]): CatalogueType[] {
  const q = normaliseName(query);
  if (!q) return [];
  const taken = new Set(rows.map((r) => r.typeId));
  return catalogue
    .filter((t) => !t.archived && !taken.has(t.id) && normaliseName(t.name).includes(q))
    .slice(0, 6);
}

export function exactMatch(query: string, catalogue: CatalogueType[]): CatalogueType | null {
  const q = normaliseName(query);
  return catalogue.find((t) => !t.archived && normaliseName(t.name) === q) ?? null;
}

/** The generalised `class_in_use` rule (F §7.3) counts annotations and findings. */
export function typeInUseMessage(err: unknown, rows: TypeRow[]): string | null {
  if (!(err instanceof ApiFailure) || err.code !== "class_in_use") return null;
  const id = typeof err.details.type_id === "string" ? err.details.type_id : err.details.class_id;
  const name = rows.find((r) => r.typeId === id)?.name ?? "That type";
  const boxes = typeof err.details.box_count === "number" ? err.details.box_count : 0;
  const findings = typeof err.details.finding_count === "number" ? err.details.finding_count : 0;
  const parts = [
    boxes > 0 ? `${boxes} ${boxes === 1 ? "annotation" : "annotations"}` : null,
    findings > 0 ? `${findings} ${findings === 1 ? "finding" : "findings"}` : null,
  ].filter(Boolean);
  const what = parts.length > 0 ? parts.join(" and ") : "annotations";
  return `"${name}" still has ${what}. Reassign or delete them before removing the type.`;
}
