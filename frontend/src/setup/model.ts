import type { CatalogueType } from "@/api/catalogue";
import { TYPE_HOTKEYS, TYPE_PALETTE } from "@/catalogue/catalogueModel";
import { normaliseName } from "@/catalogue/normaliseName";
import { formatBytes } from "@/clouds/format";
import type { IconName } from "@/ui";
import type {
  CatalogueTypeSpec,
  InspectBucket,
  ProjectTemplate,
  SlotRoute,
  TemplateSlot,
  TypeConflict,
} from "./api";
import type { DraftBucket } from "./remap";

/** A type in the draft; `key` is a stable React key, since the name can repeat across edits. */
export type DraftType = CatalogueTypeSpec & { key: string };

export const MAX_TYPES = 64;
export const ENSURE_DEBOUNCE_MS = 300;
export const MAX_DROP_PATHS = 16;
export const TRUNCATED_TEXT =
  "Not everything was sorted: the folder holds more than Kestrel sorts at once. Drop a narrower folder, or add the rest later from the project's tabs.";
export const SORTING_TEXT = "Sorting files… Create when it finishes";
export const wholeFolderText = (name: string) => `The whole folder ${name} will be imported`;
export const VIDEO_NOTE = "Video import is coming";
export const SAME_FOLDER_NOTE = "Visual and thermal photos in the same folder are imported together.";
/** The swatch for a type whose colour the server will pick. */
export const NO_COLOUR = "#a7a6c4";

export const ROUTE_ICON: Record<SlotRoute, IconName> = {
  images: "images",
  map: "map",
  elevation: "elevation",
  pointcloud: "cloud",
  drawing: "drawing",
  video: "play",
};

export function toDraftType(spec: CatalogueTypeSpec, key: string): DraftType {
  return {
    key,
    name: spec.name,
    kind: spec.kind,
    colour: spec.colour ?? null,
    default_severity: spec.default_severity ?? null,
    hotkey: spec.hotkey ? spec.hotkey.toLowerCase() : null,
    definition: spec.definition ?? null,
    severity_rules: spec.severity_rules ?? [],
  };
}

/** The spec with every field set: what `ensure` and a saved template receive. */
export function specOf(t: DraftType): CatalogueTypeSpec {
  return {
    name: t.name,
    kind: t.kind,
    colour: t.colour ?? null,
    default_severity: t.default_severity ?? null,
    hotkey: t.hotkey ?? null,
    definition: t.definition ?? null,
    severity_rules: (t.severity_rules ?? []).map((r) => ({ when: r.when, severity: r.severity })),
  };
}

export function specFromCatalogue(t: CatalogueType): CatalogueTypeSpec {
  return {
    name: t.name,
    kind: t.kind,
    colour: t.colour,
    default_severity: t.default_severity,
    hotkey: t.hotkey,
    definition: t.definition,
    severity_rules: t.severity_rules,
  };
}

/** "Keep mine and add the new ones": the current list, then each new name (by normalised name), up to 64. */
export function mergeTypes(
  current: readonly DraftType[],
  incoming: readonly CatalogueTypeSpec[],
  nextKey: () => string,
): DraftType[] {
  const seen = new Set(current.map((t) => normaliseName(t.name)));
  const out = [...current];
  for (const spec of incoming) {
    const name = normaliseName(spec.name);
    if (seen.has(name) || out.length >= MAX_TYPES) continue;
    seen.add(name);
    out.push(toDraftType(spec, nextKey()));
  }
  return out;
}

function hotkeyGroups(types: readonly DraftType[]): Map<string, DraftType[]> {
  const byKey = new Map<string, DraftType[]>();
  for (const t of types) {
    if (!t.hotkey) continue;
    const k = t.hotkey.toLowerCase();
    byKey.set(k, [...(byKey.get(k) ?? []), t]);
  }
  return byKey;
}

/** Each type whose hotkey another type also uses, mapped to that other type's name (case-insensitive). */
export function hotkeyClashes(types: readonly DraftType[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const group of hotkeyGroups(types).values()) {
    if (group.length < 2) continue;
    for (const t of group) out.set(t.key, group.find((o) => o.key !== t.key)!.name);
  }
  return out;
}

const joinNames = (names: string[]) =>
  names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** One summary line per shared hotkey. */
export function clashLines(types: readonly DraftType[]): string[] {
  return [...hotkeyGroups(types)]
    .filter(([, group]) => group.length > 1)
    .map(([k, group]) => `Hotkey ${k.toUpperCase()} is used by ${joinNames(group.map((t) => t.name))}`);
}

export function freeHotkey(types: readonly DraftType[]): string | null {
  const used = new Set(types.map((t) => t.hotkey?.toLowerCase()).filter(Boolean));
  return TYPE_HOTKEYS.find((k) => !used.has(k)) ?? null;
}

export function freeColour(types: readonly DraftType[]): string {
  const used = new Set(types.map((t) => t.colour?.toLowerCase()).filter(Boolean));
  return TYPE_PALETTE.find((c) => !used.has(c)) ?? TYPE_PALETTE[types.length % TYPE_PALETTE.length];
}

const ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;
export const isAbsolutePath = (p: string): boolean => ABSOLUTE.test(p.trim());

/** The checks the New project dialog had (F §9.2), plus a full folder path; null when both are fine. */
export function basicsError(name: string, folder: string): string | null {
  if (!name.trim()) return "Give the project a name.";
  if (!folder.trim()) return "Choose a folder for the project.";
  if (!isAbsolutePath(folder)) return "Use a full folder path, such as E:\\Projects\\Site.";
  return null;
}

export interface SlotFill {
  slot: TemplateSlot;
  buckets: DraftBucket[];
  count: number;
  bytes: number;
}

export function slotFills(slots: readonly TemplateSlot[], buckets: readonly DraftBucket[]): SlotFill[] {
  return slots.map((slot) => {
    const mine = buckets.filter((b) => !b.skipped && b.slot_key === slot.key);
    return {
      slot,
      buckets: mine,
      count: mine.reduce((n, b) => n + b.count, 0),
      bytes: mine.reduce((n, b) => n + b.bytes, 0),
    };
  });
}

export function emptyRequired(
  slots: readonly TemplateSlot[],
  buckets: readonly DraftBucket[],
): TemplateSlot[] {
  return slotFills(slots, buckets)
    .filter((f) => f.slot.required && f.buckets.length === 0)
    .map((f) => f.slot);
}

export const unusedBuckets = (buckets: readonly DraftBucket[]): DraftBucket[] =>
  buckets.filter((b) => !b.skipped && b.slot_key === null);

export const skippedBuckets = (buckets: readonly DraftBucket[]): DraftBucket[] =>
  buckets.filter((b) => b.skipped);

/** S-R4: visual and thermal photos from one folder are both in use, so they import as one source. */
export function sharesFolder(buckets: readonly DraftBucket[]): boolean {
  const live = buckets.filter((b) => !b.skipped && b.slot_key !== null && b.route === "images");
  return live.some((a) =>
    live.some(
      (b) =>
        a.id !== b.id &&
        a.folder.toLowerCase() === b.folder.toLowerCase() &&
        Boolean(a.match.thermal) !== Boolean(b.match.thermal),
    ),
  );
}

export function folderName(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function bucketLabel(b: DraftBucket): string {
  const base = folderName(b.folder);
  if (b.route === "images") return `${base} · ${b.match.thermal ? "thermal" : "visual"}`;
  return b.files.length === 1 ? folderName(b.files[0]) : base;
}

export function countLabel(b: Pick<InspectBucket, "route" | "count">): string {
  const n = b.count.toLocaleString("en-GB");
  if (b.route === "images") return `${n} ${b.count === 1 ? "photo" : "photos"}`;
  return `${n} ${b.count === 1 ? "file" : "files"}`;
}

export function sizeLabel(bytes: number): string {
  return bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1e3))} KB` : formatBytes(bytes);
}

/** S1-3: the Catalogue's type wins on a name match; the row says so before Create. */
export function conflictText(t: Pick<DraftType, "kind" | "colour">, c: TypeConflict): string | null {
  if (c.kind !== t.kind)
    return `Already in your Catalogue as ${c.kind === "defect" ? "Defect" : "Object"}. The Catalogue's kind and colour are kept.`;
  if (t.colour && c.colour.toLowerCase() !== t.colour.toLowerCase())
    return "Already in your Catalogue with another colour. The Catalogue's colour is kept.";
  return null;
}

export function templateLabel(templateId: string | null, templates: readonly ProjectTemplate[]): string {
  if (templateId === null) return "Blank";
  return templates.find((t) => t.id === templateId)?.name ?? "Blank";
}

export interface ChecklistModel {
  templateName: string;
  /** The name-and-folder problem, or null when both are fine. */
  basics: string | null;
  slotsTotal: number;
  slotsFilled: number;
  emptyRequired: TemplateSlot[];
  typeCount: number;
  clashes: string[];
  /** S-R17: a sort is still running, so its results are not yet in the draft. */
  sorting: boolean;
  /** Folder names of assigned photo buckets that came from a file, not their folder (U3 F1). */
  wholeFolders: string[];
}

export function checklistOf(
  d: {
    name: string;
    folder: string;
    slots: readonly TemplateSlot[];
    buckets: readonly DraftBucket[];
    types: readonly DraftType[];
    inspect: object | null;
  },
  templateName: string,
): ChecklistModel {
  return {
    templateName,
    basics: basicsError(d.name, d.folder),
    slotsTotal: d.slots.length,
    slotsFilled: slotFills(d.slots, d.buckets).filter((f) => f.buckets.length > 0).length,
    emptyRequired: emptyRequired(d.slots, d.buckets),
    typeCount: d.types.length,
    clashes: clashLines(d.types),
    sorting: d.inspect !== null,
    wholeFolders: [
      ...new Set(
        d.buckets
          .filter((b) => b.wholeFolder && !b.skipped && b.slot_key !== null)
          .map((b) => folderName(b.folder)),
      ),
    ],
  };
}

/**
 * Spec §8: Create needs a valid name and folder, no hotkey clash and no sort still running (S-R17: unapplied
 * results would never be imported); an empty required slot only warns (S1-6).
 */
export const canCreate = (c: ChecklistModel): boolean =>
  c.basics === null && c.clashes.length === 0 && !c.sorting;

export const issueCount = (c: ChecklistModel): number =>
  (c.basics ? 1 : 0) + c.emptyRequired.length + c.clashes.length + (c.sorting ? 1 : 0);
