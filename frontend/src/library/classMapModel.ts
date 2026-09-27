import type { LibraryModel } from "@contract/client";
import type { CatalogueType } from "@/api/catalogue";
import type { ClassMap } from "@/api/library";
import { normaliseName } from "@/catalogue/normaliseName";

/** The picker value for "ignore this class" (a `null` in `class_map`). */
export const IGNORE = "__ignore";

export type Resolution =
  | { kind: "name"; type: CatalogueType }
  | { kind: "alias"; type: CatalogueType; alias: string }
  | { kind: "map"; typeId: string | null }
  | { kind: "unmapped" };

type MapSource = Pick<LibraryModel, "class_aliases" | "class_map">;

function byName(name: string, types: CatalogueType[]): CatalogueType | null {
  const key = normaliseName(name);
  return types.find((t) => !t.archived && normaliseName(t.name) === key) ?? null;
}

/** The order runs use (F §7.4): exact normalised name, then the model's alias, then `class_map`. */
export function resolveClass(name: string, model: MapSource, types: CatalogueType[]): Resolution {
  const direct = byName(name, types);
  if (direct) return { kind: "name", type: direct };
  const alias = model.class_aliases?.[name];
  if (alias) {
    const viaAlias = byName(alias, types);
    if (viaAlias) return { kind: "alias", type: viaAlias, alias };
  }
  const map = model.class_map ?? {};
  if (Object.prototype.hasOwnProperty.call(map, name)) return { kind: "map", typeId: map[name] ?? null };
  return { kind: "unmapped" };
}

/** Classes the name and alias rules do not reach: the only ones a `class_map` entry can affect. */
export function leftoverNames(
  model: MapSource & Pick<LibraryModel, "class_names">,
  types: CatalogueType[],
): string[] {
  return model.class_names.filter((n) => {
    const r = resolveClass(n, model, types);
    return r.kind === "map" || r.kind === "unmapped";
  });
}

export function draftsOf(
  model: MapSource & Pick<LibraryModel, "class_names">,
  types: CatalogueType[],
): Record<string, string> {
  const drafts: Record<string, string> = {};
  for (const name of leftoverNames(model, types)) {
    const r = resolveClass(name, model, types);
    drafts[name] = r.kind === "map" ? (r.typeId ?? IGNORE) : "";
  }
  return drafts;
}

export function toClassMap(drafts: Record<string, string>): ClassMap {
  const map: ClassMap = {};
  for (const [name, value] of Object.entries(drafts)) {
    if (value === IGNORE) map[name] = null;
    else if (value) map[name] = value;
  }
  return map;
}

export function unmappedCount(drafts: Record<string, string>): number {
  return Object.values(drafts).filter((v) => v === "").length;
}
