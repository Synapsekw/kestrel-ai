import type { ApiClient, Project } from "@contract/client";
import {
  createCatalogueType,
  existingTypeId,
  fetchCatalogueType,
  patchCatalogueType,
  type TypeKind,
} from "@/api/catalogue";
import { fetchProject, publishProject } from "@/api/project";
import { saveProjectTypes } from "@/api/projectTypes";

export interface AddedType {
  project: Project;
  typeId: string;
}

/**
 * Creates an anomaly type while marking, or reuses the catalogue type that already has this name,
 * then makes sure the open project lists it. Screens holding `useProject` see the new list at once.
 */
export async function addProjectType(
  api: ApiClient,
  projectId: string,
  name: string,
  kind: TypeKind = "defect",
): Promise<AddedType> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name the anomaly first.");

  let typeId: string;
  try {
    typeId = (await createCatalogueType(api, { name: trimmed, kind })).id;
  } catch (e) {
    const existing = existingTypeId(e);
    if (!existing) throw e;
    const found = await fetchCatalogueType(api, existing);
    if (found.kind !== kind) {
      const what = found.kind === "object" ? "an object" : "a defect";
      throw new Error(`"${trimmed}" is already ${what}. Pick another name.`);
    }
    if (found.archived) await patchCatalogueType(api, existing, { archived: false });
    typeId = existing;
  }

  const current = await fetchProject(api, projectId);
  if (current.classes.some((c) => c.id === typeId)) {
    publishProject(current);
    return { project: current, typeId };
  }
  const project = await saveProjectTypes(api, projectId, {
    type_ids: [...current.classes.map((c) => c.id), typeId],
  });
  publishProject(project);
  return { project, typeId };
}
