import type { ModelClassMapPut } from "@/api/runs";

/** What the operator chose for one unmapped model class: a project class id, "new" or "ignore". */
export type Choice = string;
export const NEW = "__new__";
export const IGNORE = "__ignore__";

/** The `PUT /model-class-maps` body for these choices; unchosen classes are left out. */
export function mappingBody(choices: Record<string, Choice>): ModelClassMapPut {
  const mapping: Record<string, string | null> = {};
  const newClasses: string[] = [];
  for (const [name, choice] of Object.entries(choices)) {
    if (!choice) continue;
    if (choice === NEW) newClasses.push(name);
    else mapping[name] = choice === IGNORE ? null : choice;
  }
  return { mapping, new_classes: newClasses };
}

/** The model classes that still have no choice. */
export function unchosen(unmapped: string[], choices: Record<string, Choice>): string[] {
  return unmapped.filter((name) => !choices[name]);
}
