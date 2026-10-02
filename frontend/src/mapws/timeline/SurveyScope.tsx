/* eslint-disable react-refresh/only-export-components --
   the switch and the hook it shares with the topics belong to one module. */
import { useEffect } from "react";
import { Switch } from "@/ui";
import { useWorkspace, useWorkspaceStores } from "../context";
import { useDetectStore } from "../detect/detectStore";

const FINDINGS_ROW = "findings:all";

/** Spec §3.1 "Survey scope": one switch for findings and detections (measurements follow `r`). */
export function useSurveyScope(): { all: boolean; set(all: boolean): void } {
  const all = useDetectStore((s) => s.filters.allSurveys);
  const setFilters = useDetectStore((s) => s.setFilters);
  const { workspace } = useWorkspaceStores();
  return {
    all,
    set: (on) => {
      setFilters({ allSurveys: on });
      const { layerState, setLayerState } = workspace.getState();
      // Read at call time: the row's other filters must survive a flip made in the same tick.
      setLayerState(FINDINGS_ROW, { style: { ...layerState[FINDINGS_ROW]?.style, allSurveys: on } });
    },
  };
}

/** The timeline bar's survey-scope switch. */
export function SurveyScope() {
  const { all, set } = useSurveyScope();
  // The findings row's scope is persisted with the layer state; the detection filters are not. On
  // open, the persisted scope wins so the one switch tells the truth for both.
  const persisted = useWorkspace((s) => s.layerState[FINDINGS_ROW]?.style?.allSurveys === true);
  useEffect(() => {
    if (persisted !== useDetectStore.getState().filters.allSurveys)
      useDetectStore.getState().setFilters({ allSurveys: persisted });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);
  return <Switch label="All surveys" checked={all} onChange={set} className="text-xs" />;
}
