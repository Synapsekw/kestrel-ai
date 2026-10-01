import { create } from "zustand";
import { normaliseName } from "@/catalogue/normaliseName";
import type {
  CatalogueTypeSpec,
  InspectNotRecognised,
  InspectResult,
  ProjectTemplate,
  TemplateSlot,
} from "./api";
import { MAX_TYPES, mergeTypes, toDraftType, type DraftType } from "./model";
import {
  bucketId,
  canMoveTo,
  mergeBuckets,
  mergeNotRecognised,
  remap,
  slotFor,
  type DraftBucket,
} from "./remap";

export type { DraftBucket } from "./remap";
export type { DraftType } from "./model";

/** The sort in flight: its job, and the slot whose Browse started it (null for a drop). */
export interface InspectRun {
  jobId: string;
  slotKey: string | null;
  paths: string[];
}

/** The index's draft, plus U5's inspect fields (Ruling 3). It survives navigation until Create or Discard. */
export interface SetupDraft {
  templateId: string | null;
  name: string;
  folder: string;
  slots: TemplateSlot[];
  buckets: DraftBucket[];
  types: DraftType[];
  typesEdited: boolean;
  inspect: InspectRun | null;
  inspectError: string | null;
  notRecognised: InspectNotRecognised;
  truncated: boolean;
  suggestedTemplateId: string | null;
}

export interface SetupActions {
  /** `null` is Blank. `keep` merges the template's types into the list; `replace` swaps the list. */
  chooseTemplate: (t: ProjectTemplate | null, mode: "replace" | "keep") => void;
  setName: (name: string) => void;
  setFolder: (folder: string) => void;
  setBuckets: (buckets: DraftBucket[]) => void;
  moveBucket: (id: string, slotKey: string | null) => void;
  skipBucket: (id: string, skipped?: boolean) => void;
  setType: (key: string, patch: Partial<CatalogueTypeSpec>) => void;
  /** False when the name is already listed or the list holds 64 types. */
  addType: (spec: CatalogueTypeSpec) => boolean;
  removeType: (key: string) => void;
  beginInspect: (run: InspectRun) => void;
  applyInspect: (jobId: string, result: InspectResult) => void;
  failInspect: (jobId: string, message: string) => void;
  clearInspect: () => void;
  dismissInspectError: () => void;
  discard: () => void;
}

export function emptyDraft(): SetupDraft {
  return {
    templateId: null,
    name: "",
    folder: "",
    slots: [],
    buckets: [],
    types: [],
    typesEdited: false,
    inspect: null,
    inspectError: null,
    notRecognised: { count: 0, samples: [] },
    truncated: false,
    suggestedTemplateId: null,
  };
}

let seq = 0;
const nextKey = () => `type-${++seq}`;

export const useSetupDraft = create<SetupDraft & SetupActions>((set, get) => ({
  ...emptyDraft(),

  chooseTemplate: (t, mode) =>
    set((s) => {
      const slots = t?.config.slots ?? [];
      const incoming = t?.config.types ?? [];
      const types =
        mode === "replace"
          ? incoming.map((spec) => toDraftType(spec, nextKey()))
          : mergeTypes(s.types, incoming, nextKey);
      return {
        templateId: t?.id ?? null,
        slots,
        types,
        typesEdited: mode === "keep",
        buckets: remap(s.buckets, slots),
      };
    }),

  setName: (name) => set({ name }),
  setFolder: (folder) => set({ folder }),
  setBuckets: (buckets) => set({ buckets }),

  moveBucket: (id, slotKey) =>
    set((s) => ({
      buckets: s.buckets.map((b) => (b.id === id ? { ...b, slot_key: slotKey, skipped: false } : b)),
    })),

  skipBucket: (id, skipped = true) =>
    set((s) => ({ buckets: s.buckets.map((b) => (b.id === id ? { ...b, skipped } : b)) })),

  setType: (key, patch) =>
    set((s) => ({
      types: s.types.map((t) =>
        t.key === key
          ? {
              ...t,
              ...patch,
              hotkey: (patch.hotkey !== undefined ? patch.hotkey : t.hotkey)?.toLowerCase() ?? null,
            }
          : t,
      ),
      typesEdited: true,
    })),

  addType: (spec) => {
    const s = get();
    const name = normaliseName(spec.name);
    if (s.types.length >= MAX_TYPES || s.types.some((t) => normaliseName(t.name) === name)) return false;
    set({ types: [...s.types, toDraftType(spec, nextKey())], typesEdited: true });
    return true;
  },

  removeType: (key) => set((s) => ({ types: s.types.filter((t) => t.key !== key), typesEdited: true })),

  beginInspect: (run) => set({ inspect: run, inspectError: null }),

  applyInspect: (jobId, result) =>
    set((s) => {
      if (s.inspect?.jobId !== jobId) return s;
      const run = s.inspect;
      const target = s.slots.find((x) => x.key === run.slotKey) ?? null;
      const incoming: DraftBucket[] = result.buckets.map((b) => {
        const d = { ...b, id: bucketId(b, run.paths), skipped: false };
        return { ...d, slot_key: target && canMoveTo(d, target) ? target.key : slotFor(d, s.slots) };
      });
      return {
        buckets: mergeBuckets(s.buckets, incoming),
        notRecognised: mergeNotRecognised(s.notRecognised, result.not_recognised),
        truncated: result.truncated,
        suggestedTemplateId: result.suggested_template_id,
        inspect: null,
        inspectError: null,
      };
    }),

  failInspect: (jobId, message) =>
    set((s) => (s.inspect?.jobId === jobId ? { inspect: null, inspectError: message } : s)),

  clearInspect: () => set({ inspect: null, inspectError: null }),
  dismissInspectError: () => set({ inspectError: null }),
  discard: () => set(emptyDraft()),
}));

/** The draft's data without its actions: what Create and Save as my template read. */
export function draftSnapshot(): SetupDraft {
  const s = useSetupDraft.getState();
  return {
    templateId: s.templateId,
    name: s.name,
    folder: s.folder,
    slots: s.slots,
    buckets: s.buckets,
    types: s.types,
    typesEdited: s.typesEdited,
    inspect: s.inspect,
    inspectError: s.inspectError,
    notRecognised: s.notRecognised,
    truncated: s.truncated,
    suggestedTemplateId: s.suggestedTemplateId,
  };
}
