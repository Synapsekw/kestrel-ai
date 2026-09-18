import type { ClassDef, ClassDefInput } from "@contract/client";
import { ApiFailure } from "@/api/errors";

export interface DraftClass {
  id?: string;
  name: string;
  colour: string;
  hotkey: string;
}

export const PALETTE = [
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
  "#ef4444",
];

export function toDrafts(classes: ClassDef[]): DraftClass[] {
  return [...classes]
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ id: c.id, name: c.name, colour: c.colour, hotkey: c.hotkey ?? "" }));
}

/** Items with an `id` keep it (rename, recolour, rehotkey); items without one are new (contract `updateClasses`). */
export function toClassInputs(drafts: DraftClass[]): ClassDefInput[] {
  return drafts.map((d) => ({
    ...(d.id ? { id: d.id } : {}),
    name: d.name.trim(),
    colour: d.colour,
    hotkey: d.hotkey ? d.hotkey : null,
  }));
}

export function validateDrafts(drafts: DraftClass[]): string | null {
  const names = new Set<string>();
  const keys = new Set<string>();
  for (const d of drafts) {
    const name = d.name.trim();
    if (!name) return "Every class needs a name.";
    if (names.has(name)) return `Class name "${name}" is used twice.`;
    names.add(name);
    if (d.hotkey) {
      if (!/^[1-9]$/.test(d.hotkey)) return "Hotkeys must be a digit from 1 to 9.";
      if (keys.has(d.hotkey)) return `Hotkey ${d.hotkey} is used twice.`;
      keys.add(d.hotkey);
    }
  }
  return null;
}

/** Spec section 6: deleting a class with boxes is refused; the UI must explain what to do. */
export function classInUseMessage(err: unknown, classes: ClassDef[]): string | null {
  if (!(err instanceof ApiFailure) || err.code !== "class_in_use") return null;
  const classId = typeof err.details.class_id === "string" ? err.details.class_id : null;
  const count = typeof err.details.box_count === "number" ? err.details.box_count : null;
  const name = classes.find((c) => c.id === classId)?.name ?? "that class";
  const boxes = count === null ? "boxes" : `${count} ${count === 1 ? "box" : "boxes"}`;
  return `Class "${name}" still has ${boxes}. Reassign or delete those boxes in the editor before removing it.`;
}

export function nextColour(drafts: DraftClass[]): string {
  const used = new Set(drafts.map((d) => d.colour.toLowerCase()));
  return PALETTE.find((c) => !used.has(c)) ?? PALETTE[drafts.length % PALETTE.length];
}

export function moveDraft(drafts: DraftClass[], index: number, delta: number): DraftClass[] {
  const target = index + delta;
  if (target < 0 || target >= drafts.length) return drafts;
  const next = [...drafts];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
