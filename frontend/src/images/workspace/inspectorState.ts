import type { Box, ClassDef } from "@contract/client";

export type InspectorState =
  | { kind: "finding"; findingId: string; box: Box | null }
  | { kind: "pending-finding"; box: Box }
  | { kind: "object"; box: Box }
  | { kind: "suggestion"; box: Box }
  | { kind: "image" };

export function isSuggestion(b: Box): boolean {
  return b.provenance.kind !== "person" && b.review_state === "unreviewed";
}

/** §6.3's four panels. The selected unreviewed box is the focused suggestion (FA's R-FA1). */
export function inspectorState(i: {
  selectedId: string | null;
  boxes: Readonly<Record<string, Box>>;
  findingOf: (boxId: string) => string | null;
  types: ReadonlyMap<string, ClassDef>;
}): InspectorState {
  const box = i.selectedId ? i.boxes[i.selectedId] : undefined;
  if (!box || box.review_state === "rejected") return { kind: "image" };
  if (isSuggestion(box)) return { kind: "suggestion", box };
  const fid = i.findingOf(box.id);
  if (fid) return { kind: "finding", findingId: fid, box };
  if (i.types.get(box.class_id)?.kind === "defect") return { kind: "pending-finding", box };
  return { kind: "object", box };
}
