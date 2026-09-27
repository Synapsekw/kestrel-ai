import type { ClassDef } from "@contract/client";
import { tokenColour, withAlpha } from "@/maps/styles";

// F6 ruling: colours.ts must not copy tokenColour/withAlpha from maps/styles.ts — re-export them
// and build image-specific helpers (typeColour) on top.
export { tokenColour, withAlpha };

export function typeColour(types: readonly ClassDef[], typeId: string): string {
  return types.find((t) => t.id === typeId)?.colour ?? "#94a3b8";
}
