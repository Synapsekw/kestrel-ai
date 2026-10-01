import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "@/api/client";
import { pushLog } from "@/app/diagnostics";
import { runSetup } from "./dispatch";
import { useSetupDraft, type SetupDraft } from "./draftStore";

/**
 * The setup page's Create project (spec §7.4). Resolves once the project exists: the draft is
 * cleared and the Overview opens while the imports start in `useSetupImports`. Rejects with the
 * error the summary shows, keeping the draft.
 */
export function useCreateProject(): (draft: SetupDraft) => Promise<void> {
  const api = useApi();
  const navigate = useNavigate();
  return useCallback(
    async (draft: SetupDraft) => {
      const { projectId } = await runSetup(api, draft);
      pushLog(`created project ${projectId} from the setup page`);
      useSetupDraft.getState().discard();
      void navigate(`/p/${projectId}/overview`);
    },
    [api, navigate],
  );
}
