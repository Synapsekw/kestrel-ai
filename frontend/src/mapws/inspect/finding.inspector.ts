import { deleteFinding } from "@/api/findings";
import { useChangesStore } from "@/store/changes";
import { FindingBody } from "./FindingBody";
import type { InspectorKind } from "./inspectorRegistry";

/** Spec §5.3 Finding: F's shared inspector (its own pane, R-W1-11) with the map strip. */
const finding: InspectorKind = {
  id: "finding",
  label: "Finding",
  framed: false,
  Body: FindingBody,
  remove: {
    confirm: () => "Delete this finding? This cannot be undone.",
    run: async (sel, { api, projectId }) => {
      // Global Constraints §1: changesOwnWrite.ts is not on main; keep the plain bump (I-FB not merged).
      await deleteFinding(api, projectId, sel.id);
      useChangesStore.getState().bumpFindings();
    },
  },
};

export default finding;
