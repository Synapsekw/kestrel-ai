import type { CatalogueType, CatalogueTypeCreate, CatalogueTypePatch, TypeKind } from "@/api/catalogue";
import { normaliseName } from "./normaliseName";

export type KindFilter = "all" | TypeKind;

export interface TypeFilters {
  q: string;
  kind: KindFilter;
  showArchived: boolean;
  /** Only `origin = migrated` (the classification banner's view, §7.5). */
  migratedOnly: boolean;
}

export const DEFAULT_FILTERS: TypeFilters = { q: "", kind: "all", showArchived: false, migratedOnly: false };

/** Digits 1–9 and letters, as §7.2 allows; live only inside a type picker, never at workspace level. */
export const TYPE_HOTKEYS = [..."123456789abcdefghijklmnopqrstuvwxyz"];

export const TYPE_PALETTE = [
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
  "#ef4444",
];

/** Reused by the Type editor and the project type list instead of each defining its own `KINDS` (ruling P18). */
export const KIND_OPTIONS: { value: TypeKind; label: string }[] = [
  { value: "defect", label: "Defect" },
  { value: "object", label: "Object" },
];

export function filterTypes(types: CatalogueType[], f: TypeFilters): CatalogueType[] {
  const q = normaliseName(f.q);
  return types
    .filter((t) => f.showArchived || !t.archived)
    .filter((t) => f.kind === "all" || t.kind === f.kind)
    .filter((t) => !f.migratedOnly || t.origin === "migrated")
    .filter((t) => !q || normaliseName(t.name).includes(q) || normaliseName(t.group ?? "").includes(q))
    .sort((a, b) => (a.group ?? "").localeCompare(b.group ?? "") || a.name.localeCompare(b.name));
}

/** The banner's count (plan decision 2): types that came from existing projects and are still live. */
export function migratedCount(types: CatalogueType[]): number {
  return types.filter((t) => t.origin === "migrated" && !t.archived).length;
}

export interface TypeDraft {
  name: string;
  colour: string;
  kind: TypeKind;
  group: string;
  defaultSeverity: number | null;
  hotkey: string;
}

export function nextTypeColour(types: CatalogueType[]): string {
  const used = new Set(types.filter((t) => !t.archived).map((t) => t.colour.toLowerCase()));
  return TYPE_PALETTE.find((c) => !used.has(c)) ?? TYPE_PALETTE[types.length % TYPE_PALETTE.length];
}

/** A new type starts as a defect (plan decision 17); an existing one copies its fields. */
export function draftOf(type: CatalogueType | null, types: CatalogueType[]): TypeDraft {
  if (!type) {
    return {
      name: "",
      colour: nextTypeColour(types),
      kind: "defect",
      group: "",
      defaultSeverity: null,
      hotkey: "",
    };
  }
  return {
    name: type.name,
    colour: type.colour,
    kind: type.kind,
    group: type.group ?? "",
    defaultSeverity: type.default_severity ?? null,
    hotkey: type.hotkey ?? "",
  };
}

/** A live type other than `selfId` whose name normalises to the draft's. */
export function findClash(d: TypeDraft, types: CatalogueType[], selfId?: string): CatalogueType | null {
  const key = normaliseName(d.name);
  if (!key) return null;
  return types.find((t) => t.id !== selfId && !t.archived && normaliseName(t.name) === key) ?? null;
}

export function validateTypeDraft(d: TypeDraft, types: CatalogueType[], selfId?: string): string | null {
  const name = d.name.trim();
  if (!name) return "Give the type a name.";
  if (name.length > 60) return "Keep the name to 60 characters or fewer.";
  if (!/^#[0-9a-f]{6}$/i.test(d.colour)) return "Choose a colour.";
  const clash = findClash(d, types, selfId);
  if (clash) return `"${clash.name}" already exists. Open it instead of creating a second one.`;
  if (d.hotkey) {
    if (!TYPE_HOTKEYS.includes(d.hotkey)) return "A hotkey is one digit from 1 to 9 or one letter.";
    const taken = types.find((t) => t.id !== selfId && !t.archived && t.hotkey === d.hotkey);
    if (taken) return `Hotkey ${d.hotkey.toUpperCase()} is already used by "${taken.name}".`;
  }
  return null;
}

export function toCreate(d: TypeDraft): CatalogueTypeCreate {
  return {
    name: d.name.trim(),
    colour: d.colour,
    kind: d.kind,
    group: d.group.trim() || null,
    default_severity: d.defaultSeverity,
    hotkey: d.hotkey || null,
  };
}

export function toPatch(d: TypeDraft, t: CatalogueType): CatalogueTypePatch {
  const patch: CatalogueTypePatch = {};
  const name = d.name.trim();
  const group = d.group.trim() || null;
  const hotkey = d.hotkey || null;
  if (name !== t.name) patch.name = name;
  if (d.colour !== t.colour) patch.colour = d.colour;
  if (d.kind !== t.kind) patch.kind = d.kind;
  if (group !== (t.group ?? null)) patch.group = group;
  if (d.defaultSeverity !== (t.default_severity ?? null)) patch.default_severity = d.defaultSeverity;
  if (hotkey !== (t.hotkey ?? null)) patch.hotkey = hotkey;
  return patch;
}
