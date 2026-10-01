import type { components } from "@contract/client";
import type { SetupDraft } from "./draftStore";
import { specOf, type DraftType } from "./model";

type S = components["schemas"];
type CatalogueTypeSpec = S["CatalogueTypeSpec"];
type EnsuredType = S["EnsuredType"];

/** The routes Create starts; `video` waits for S4 (ruling S-R6). */
export type ImportRoute = Exclude<S["SlotRoute"], "video">;

/** `needs_choice`: a drawing the operator must finish in Add data (plan ruling U6-1). */
export type UnitState = "pending" | "started" | "failed" | "needs_choice";

/** One import Create starts: one folder of photos, or one file of any other kind. */
export interface ImportUnit {
  /** `route:` plus the normalised path, so a folder shared by visual and thermal is one unit (S-R4). */
  id: string;
  route: ImportRoute;
  path: string;
  /** The slots this import fills: two when visual and thermal photos share a folder. */
  slotKeys: string[];
  state: UnitState;
  error?: string;
  jobId?: string;
  /** Why the plan will not start this unit by itself (ruling U6-6); the store records it as failed. */
  blocked?: string;
}

/** Files an inspect counted past its 200-per-bucket list: the draft has no paths for them. */
export interface OmittedFiles {
  slotKey: string;
  folder: string;
  count: number;
  /** The project tab whose Add data imports them. */
  tab: "Maps" | "Point clouds";
}

export interface ImportPlan {
  /** Slot key to label, in the template's slot order, for every slot that got an import. */
  labels: Record<string, string>;
  units: ImportUnit[];
  /** Coordinator ruling on question 4: never silent; the notice names them. */
  omitted: OmittedFiles[];
}

const TAB: Record<Exclude<ImportRoute, "images">, OmittedFiles["tab"]> = {
  map: "Maps",
  elevation: "Maps",
  drawing: "Maps",
  pointcloud: "Point clouds",
};

/** What starting one unit answered: its job, or what the operator has to choose. */
export type StartOutcome = { state: "started"; jobId: string } | { state: "needs_choice"; error: string };

/** A Windows path as a key: either slash, no trailing separator, case-insensitive. */
export function pathKey(path: string): string {
  return path.trim().replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

/** Whether key `child` names a folder strictly inside key `parent` (`E:\d\dcim2` is not inside `E:\d\dcim`). */
function inside(child: string, parent: string): boolean {
  return child.startsWith(`${parent}\\`);
}

/**
 * The imports Create starts (spec §7.4): every bucket assigned to a slot of the draft's template,
 * except skipped buckets and video (S-R6). Every route but photos starts once per file. Photos start
 * once per **top-most** folder, because `POST /sources` reads its folder recursively: a folder the
 * visual and thermal slots share (S-R4), or one nested inside another dispatched photo folder, is
 * imported through the outer folder, listed under every slot it fills (ruling U6-6). A photo folder
 * that holds a map or elevation GeoTIFF in or under it is planned `blocked`: the photo importer
 * would take the GeoTIFFs as photos. Pure.
 */
export function planImports(draft: Pick<SetupDraft, "slots" | "buckets">): ImportPlan {
  const slots = new Map(draft.slots.map((s) => [s.key, s]));
  const units = new Map<string, ImportUnit>();
  const seen = new Map<string, ImportUnit>();
  const used = new Set<string>();
  const omitted: OmittedFiles[] = [];
  for (const b of draft.buckets) {
    const slot = b.slot_key ? slots.get(b.slot_key) : undefined;
    // A bucket goes through its slot's route, not its own (ruling S-R15).
    if (b.skipped || !slot || slot.route === "video") continue;
    const route = slot.route;
    used.add(slot.key);
    if (route !== "images" && b.count > b.files.length)
      omitted.push({ slotKey: slot.key, folder: b.folder, count: b.count - b.files.length, tab: TAB[route] });
    for (const path of route === "images" ? [b.folder] : b.files) {
      // A path is dispatched once across every bucket and route; the first in bucket order wins.
      const prior = seen.get(pathKey(path));
      if (prior) {
        if (prior.route === route && !prior.slotKeys.includes(slot.key)) prior.slotKeys.push(slot.key);
        continue;
      }
      const unit: ImportUnit = {
        id: `${route}:${pathKey(path)}`,
        route,
        path,
        slotKeys: [slot.key],
        state: "pending",
      };
      units.set(unit.id, unit);
      seen.set(pathKey(path), unit);
    }
  }

  // Outer folders first, so a chain A ⊃ B ⊃ C folds B and C into A.
  const photos = [...units.values()]
    .filter((u) => u.route === "images")
    .sort((a, b) => a.id.length - b.id.length);
  for (const inner of photos) {
    const key = pathKey(inner.path);
    const outer = photos.find((o) => o !== inner && units.has(o.id) && inside(key, pathKey(o.path)));
    if (!outer) continue;
    for (const k of inner.slotKeys) if (!outer.slotKeys.includes(k)) outer.slotKeys.push(k);
    units.delete(inner.id);
  }

  // Any map or elevation file on disk under a photo folder, whatever the operator did with its bucket.
  const rasters = draft.buckets
    .filter((b) => b.route === "map" || b.route === "elevation")
    .map((b) => pathKey(b.folder));
  for (const u of units.values()) {
    if (u.route !== "images") continue;
    const key = pathKey(u.path);
    if (rasters.some((r) => r === key || inside(r, key)))
      u.blocked =
        `Photos in ${u.path} were not imported: the folder also holds GeoTIFFs, which a photo import ` +
        "would take as photos. Move the GeoTIFFs out of it, then Retry.";
  }

  const labels: Record<string, string> = {};
  for (const s of draft.slots) if (used.has(s.key)) labels[s.key] = s.label;
  return { labels, units: [...units.values()], omitted };
}

/**
 * The draft's types as `ensure` takes them: the contract's fields only. The request schema has
 * `additionalProperties: false`, and the draft's UI-only `key` would make it a 422 (ADR
 * 2026-09-30-gotcha-ui-only-keys-in-a-strict-request-body).
 */
export function typeSpecs(types: DraftType[]): CatalogueTypeSpec[] {
  return types.map((t) => specOf({ ...t, name: t.name.trim() }));
}

/**
 * `POST /projects`' `type_ids` and `hotkeys` from `ensure`'s answer (same order as the request).
 * Two names that normalise alike come back with one id, sent once (`type_ids` is `uniqueItems`); the
 * first row's hotkey wins.
 */
export function projectTypes(
  types: DraftType[],
  ensured: EnsuredType[],
): { typeIds: string[]; hotkeys: Record<string, string> } {
  if (ensured.length !== types.length)
    throw new Error(`the catalogue answered for ${ensured.length} of ${types.length} types`);
  const typeIds: string[] = [];
  const hotkeys: Record<string, string> = {};
  ensured.forEach((e, i) => {
    if (e.id === null) throw new Error(`the catalogue returned no id for ${e.name}`);
    if (typeIds.includes(e.id)) return;
    typeIds.push(e.id);
    const hotkey = types[i].hotkey;
    if (hotkey) hotkeys[e.id] = hotkey;
  });
  return { typeIds, hotkeys };
}
