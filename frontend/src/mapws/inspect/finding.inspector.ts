import { deleteFinding } from "@/api/findings";
import { ownFindingsWrite } from "@/store/changesOwnWrite";
import { FindingBody } from "./FindingBody";
import type { InspectorKind } from "./inspectorRegistry";

/** Spec §5.3 Finding: F's shared inspector (its own pane, R-W1-11) with the map strip. */
const finding: InspectorKind = {
  id: "finding",
  label: "Finding",
  framed: false,
  Body: FindingBody,
  remove: {
    // W1's dialog title already asks "Delete this finding?" (M-W3 P9).
    confirm: () => "This cannot be undone.",
    // Global Constraints §1 / M-W3 P10: an own finding write — one bump on success, its echo swallowed.
    run: async (sel, { api, projectId }) => {
      await ownFindingsWrite([sel.id], () => deleteFinding(api, projectId, sel.id));
    },
  },
};

export default finding;
