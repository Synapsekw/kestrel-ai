import type { ApiClient, Project, ProjectCreate } from "@contract/client";
import { unwrap } from "@/api/errors";
import { ensureTypes } from "./api";
import type { SetupDraft } from "./draftStore";
import { specOf } from "./model";

/**
 * S-R5: U5's working Create, until U6's `runSetup` replaces it. `ensure` resolves every type in one
 * catalogue transaction, then `POST /projects` creates the project with their ids and hotkeys. No import
 * is started. A failed `ensure` stops before the project is created (spec §11).
 */
export async function createFromDraft(api: ApiClient, draft: SetupDraft): Promise<Project> {
  const typeIds: string[] = [];
  const hotkeys: Record<string, string> = {};
  if (draft.types.length > 0) {
    const ensured = await ensureTypes(api, { types: draft.types.map(specOf) });
    ensured.items.forEach((item, i) => {
      if (!item.id || typeIds.includes(item.id)) return;
      typeIds.push(item.id);
      const hotkey = draft.types[i]?.hotkey;
      if (hotkey) hotkeys[item.id] = hotkey;
    });
  }
  const body: ProjectCreate = {
    name: draft.name.trim(),
    folder: draft.folder.trim(),
    type_ids: typeIds,
    ...(Object.keys(hotkeys).length > 0 ? { hotkeys } : {}),
  };
  return unwrap(api.POST("/api/v1/projects", { body }));
}
