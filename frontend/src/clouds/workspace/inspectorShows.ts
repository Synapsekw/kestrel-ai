import { createContext } from "react";

/** Which topic's selection the workspace inspector shows (ruling R10), or null when it is empty. */
export type InspectorShows = "findings" | "measure" | null;

/**
 * Lets the Findings list tell "the finding the inspector shows" from "a finding that is selected
 * but hidden behind a later measurement": a click on the first deselects it, a click on the second
 * brings it forward. Outside the rail (no provider) the list behaves as if its finding is shown.
 */
export const InspectorShowsContext = createContext<InspectorShows>("findings");
