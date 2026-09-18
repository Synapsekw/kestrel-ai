import type { ClassDef, Provenance } from "@contract/client";

export function colourOf(classes: ClassDef[], classId: string): string {
  return classes.find((c) => c.id === classId)?.colour ?? "#94a3b8";
}

export function nameOf(classes: ClassDef[], classId: string): string {
  return classes.find((c) => c.id === classId)?.name ?? "unknown class";
}

/** Badge text for the region list: who produced the box. */
export function provenanceLabel(p: Provenance): string {
  if (p.kind === "person") return "Person";
  if (p.kind === "local_model") return p.model_name ? `Model ${p.model_name}` : "Model";
  return p.provider ? `Cloud ${p.provider}` : "Cloud";
}
