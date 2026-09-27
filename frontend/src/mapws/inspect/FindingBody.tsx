import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useApi } from "@/api/client";
import { fetchFinding } from "@/api/findings";
import { fetchMap } from "@/api/maps";
import { FindingInspector } from "@/findings/FindingInspector";
import { Button } from "@/ui";
import { mapSurveyDate } from "../arrival/arrival";
import { useWorkspace } from "../context";
import { useRegistry } from "../registry";
import { flownDates } from "../state/surveys";
import { slotRegistry, type InspectorBodyProps } from "./inspectorRegistry";
import { otherSurvey } from "./otherSurvey";

function useAnchorDate(projectId: string, findingId: string): string | null {
  const api = useApi();
  const [found, setFound] = useState<{
    id: string;
    date: string | null;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchFinding(api, projectId, findingId)
      .then((f) => (f.anchor.kind === "map" ? fetchMap(api, projectId, f.anchor.map_id) : null))
      .then((m) => !cancelled && setFound({ id: findingId, date: m ? mapSurveyDate(m) : null }))
      .catch(() => !cancelled && setFound({ id: findingId, date: null }));
    return () => {
      cancelled = true;
    };
  }, [api, projectId, findingId]);
  return found?.id === findingId ? found.date : null;
}

/** F's anchorSlot in the map: the anchor map's date and "Show on other survey". */
export function FindingMapStrip({ projectId, findingId }: { projectId: string; findingId: string }) {
  const date = useAnchorDate(projectId, findingId);
  const { surveys, l, r, mode } = useWorkspace(
    useShallow((s) => ({ surveys: s.surveys, l: s.l, r: s.r, mode: s.mode })),
  );
  const setDates = useWorkspace((s) => s.setDates);
  const anchor = date ?? r;
  const other = otherSurvey(flownDates(surveys), anchor);
  const show = () => {
    if (!other || !anchor) return;
    if (mode === "single") setDates(l, other);
    else setDates(anchor < other ? anchor : other, anchor < other ? other : anchor);
  };
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted">
        On the map of <span className="font-mono text-ink">{date ?? "…"}</span>
      </span>
      <Button
        size="sm"
        variant="ghost"
        disabled={!other}
        title={other ? undefined : "One survey so far"}
        onClick={show}
      >
        Show on other survey
      </Button>
    </div>
  );
}

export function FindingBody({ selection, projectId, frame, onClose }: InspectorBodyProps) {
  const navigate = useNavigate();
  const measure = useRegistry(slotRegistry).find((s) => s.id === "finding.measure");
  return (
    <FindingInspector
      projectId={projectId}
      findingId={selection.id}
      anchorSlot={<FindingMapStrip projectId={projectId} findingId={selection.id} />}
      measureSlot={
        measure ? <measure.Component selection={selection} projectId={projectId} frame={frame} /> : undefined
      }
      onNavigate={(href) => (href === null ? onClose() : navigate(href))}
    />
  );
}
