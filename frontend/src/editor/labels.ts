import type { ClassDef } from "@contract/client";

export function colourOf(classes: ClassDef[], classId: string): string {
  return classes.find((c) => c.id === classId)?.colour ?? "#94a3b8";
}

export function nameOf(classes: ClassDef[], classId: string): string {
  return classes.find((c) => c.id === classId)?.name ?? "unknown class";
}
