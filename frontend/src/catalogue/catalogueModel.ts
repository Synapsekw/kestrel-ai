import type { CatalogueType, CatalogueTypeCreate, CatalogueTypePatch, TypeKind } from "@/api/catalogue";
import { normaliseName } from "./normaliseName";
import { MAX_DEFINITION, rulesOf, sameRules, toRules, type RuleDraft } from "./severityRulesModel";

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
  /** What the anomaly looks like (S1 §5); trimmed on save, empty means none. */
  definition: string;
  /** Ordered severity rules (S1 §5). */
  rules: RuleDraft[];
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
      definition: "",
      rules: [],
    };
  }
  return {
    name: type.name,
    colour: type.colour,
    kind: type.kind,
    group: type.group ?? "",
    defaultSeverity: type.default_severity ?? null,
    hotkey: type.hotkey ?? "",
    // `??`: an answer from a catalogue without migration 0003 has neither field (S1 §11).
    definition: type.definition ?? "",
    rules: rulesOf(type.severity_rules),
  };
}

/**
 * False for an answer from a catalogue whose migration 0003 did not run: the editor then hides the
 * definition and the rules for that type and never sends them (S1 §11). A new type shows them.
 */
export function supportsDefinition(type: CatalogueType | null): boolean {
  return type === null || (type.definition !== undefined && type.severity_rules !== undefined);
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
  if (d.definition.trim().length > MAX_DEFINITION) {
    return `Keep the definition to ${MAX_DEFINITION} characters or fewer.`;
  }
  const clash = findClash(d, types, selfId);
  if (clash) return `"${clash.name}" already exists. Open it instead of creating a second one.`;
  if (d.hotkey) {
    if (!TYPE_HOTKEYS.includes(d.hotkey)) return "A hotkey is one digit from 1 to 9 or one letter.";
    const taken = types.find((t) => t.id !== selfId && !t.archived && t.hotkey === d.hotkey);
    if (taken) return `Hotkey ${d.hotkey.toUpperCase()} is already used by "${taken.name}".`;
  }
  return null;
}

/** Definition and rules are left out when empty, so the body of a plain type is what it always was. */
export function toCreate(d: TypeDraft): CatalogueTypeCreate {
  const body: CatalogueTypeCreate = {
    name: d.name.trim(),
    colour: d.colour,
    kind: d.kind,
    group: d.group.trim() || null,
    default_severity: d.defaultSeverity,
    hotkey: d.hotkey || null,
  };
  const definition = d.definition.trim();
  if (definition) body.definition = definition;
  if (d.rules.length > 0) body.severity_rules = toRules(d.rules);
  return body;
}

/** Only what changed; the rules go as the whole ordered list when any of them changed or moved. */
export function toPatch(d: TypeDraft, t: CatalogueType): CatalogueTypePatch {
  const patch: CatalogueTypePatch = {};
  const name = d.name.trim();
  const group = d.group.trim() || null;
  const hotkey = d.hotkey || null;
  const definition = d.definition.trim() || null;
  const rules = toRules(d.rules);
  if (name !== t.name) patch.name = name;
  if (d.colour !== t.colour) patch.colour = d.colour;
  if (d.kind !== t.kind) patch.kind = d.kind;
  if (group !== (t.group ?? null)) patch.group = group;
  if (d.defaultSeverity !== (t.default_severity ?? null)) patch.default_severity = d.defaultSeverity;
  if (hotkey !== (t.hotkey ?? null)) patch.hotkey = hotkey;
  if (definition !== (t.definition?.trim() || null)) patch.definition = definition;
  if (!sameRules(rules, t.severity_rules ?? [])) patch.severity_rules = rules;
  return patch;
}
