import type { ClassDefInput, Project, ProjectCreate } from "@contract/client";

/**
 * Transition shim, foundation unit C0 until unit SH (spec 2026-09-26-foundation-design, F5 and
 * §6.2). The contract has no project kind any more, but until SH deletes the kind UI (`KindRoute`,
 * `useProjectKind`, the sidebar steps, the kind pill) those screens still branch on it. A backend
 * from before unit BK still sends `kind`; the Prism mock and a backend after BK do not, and then a
 * project reads as `train`, which is what the mock's example project said before C0, so the e2e
 * suite keeps its behaviour. SH deletes this file together with every import of it.
 */
export type ProjectKind = "train" | "detect";

/** The kind the pre-foundation screens branch on. */
export function legacyKind(project: Project): ProjectKind {
  return (project as { kind?: unknown }).kind === "detect" ? "detect" : "train";
}

/** A project that reads as `kind` (test fixtures). */
export function withLegacyKind(project: Project, kind: ProjectKind): Project {
  return { ...project, kind } as Project;
}

/**
 * A create body both backends accept: `type_ids` for the contract and a backend after BK, `kind`
 * and `classes` for a backend before BK, which ignores `type_ids` (and BK ignores the other two).
 */
export function legacyCreateBody(
  name: string,
  folder: string,
  kind: ProjectKind,
  classes: ClassDefInput[],
): ProjectCreate {
  return { name, folder, type_ids: [], kind, classes } as ProjectCreate;
}
