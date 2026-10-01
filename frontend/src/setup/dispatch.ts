import type { ApiClient, components } from "@contract/client";
import { ApiFailure, unwrap } from "@/api/errors";
import { ensureTypes } from "./api";
import type { SetupDraft } from "./draftStore";
import { planImports, projectTypes, typeSpecs } from "./importPlan";
import { useSetupImports } from "./setupImports";

export { slotImports, useSetupImports, type SlotImport } from "./setupImports";

type ProjectCreate = components["schemas"]["ProjectCreate"];

/** An ensure refusal names the offending type in `details.name`; put it in front of the message. */
function nameTheType(err: unknown): unknown {
  if (!(err instanceof ApiFailure)) return err;
  const name = err.details.name;
  if (typeof name !== "string" || name === "" || err.message.includes(name)) return err;
  return new ApiFailure(err.code, `${name}: ${err.message}`, err.status, err.details);
}

/**
 * Create project (spec §7.4): ensure the draft's types in the Catalogue, create the project with
 * their ids and hotkeys, then hand every slot's import to `useSetupImports` without waiting for it,
 * so the caller opens the Overview while the imports start. Throws before anything is created when
 * `ensure` fails. When `POST /projects` fails the ensured types stay in the Catalogue, and a second
 * Create finds them again by name (spec §11); no import starts without a project.
 */
export async function runSetup(api: ApiClient, draft: SetupDraft): Promise<{ projectId: string }> {
  let typeIds: string[] = [];
  let hotkeys: Record<string, string> = {};
  if (draft.types.length > 0) {
    const ensured = await ensureTypes(api, { types: typeSpecs(draft.types) }).catch((e: unknown) => {
      throw nameTheType(e);
    });
    ({ typeIds, hotkeys } = projectTypes(draft.types, ensured.items));
  }
  const body: ProjectCreate = { name: draft.name.trim(), folder: draft.folder.trim(), type_ids: typeIds };
  if (Object.keys(hotkeys).length > 0) body.hotkeys = hotkeys;
  const project = await unwrap(api.POST("/api/v1/projects", { body }));
  const plan = planImports(draft);
  if (plan.units.length > 0 || plan.omitted.length > 0)
    void useSetupImports.getState().start(api, project.id, plan);
  return { projectId: project.id };
}
