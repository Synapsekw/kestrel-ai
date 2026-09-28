import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { MapRun } from "@contract/client";
import { useApi } from "@/api/client";
import { fetchMapRun } from "@/api/maps";
import { useProjectTypes } from "@/findings/useProjectTypes";
import { REVIEW_STATE } from "@/maps/reviewState";
import { formatSurveyDate, useOpenIn3d, useWorkspace, type InspectorBodyProps } from "@/mapws/w4host";
import {
  Button,
  ComboboxList,
  InspectorPane,
  InspectorSection,
  KeyChord,
  Pill,
  Popover,
  TypeChip,
  useToolShortcuts,
} from "@/ui";
import { ConfirmFindingDelete } from "./ConfirmFindingDelete";
import { boxCentre, isPending, parseDetectionId } from "./detectModel";
import { useDetectStore } from "./detectStore";
import { useReview, type KindOf, type ReviewAction } from "./useReview";

/** The detection inspector (spec §5.3): type, confidence, model, map date, review state, the accept /
 * reject / type buttons of MapReviewPanel on F's review keys, and the 3D jump (R-W4-13). */
export function DetectionInspector({ selection, projectId }: InspectorBodyProps) {
  const api = useApi();
  const navigate = useNavigate();
  const select = useWorkspace((s) => s.select);
  const surveys = useWorkspace((s) => s.surveys);
  const openIn3d = useOpenIn3d();
  const parsed = parseDetectionId(selection.id);
  const entry = useDetectStore((s) => (parsed ? s.byId.get(parsed.detectionId) : undefined));
  const { types, all } = useProjectTypes(projectId);
  const review = useReview(projectId);
  const [run, setRun] = useState<MapRun | null>(null);
  const [picking, setPicking] = useState(false);
  const typeButton = useRef<HTMLButtonElement>(null);
  const d = entry?.d ?? null;
  const runId = parsed?.runId ?? "";
  const kindOf: KindOf = (t) => types.get(t)?.kind;

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    fetchMapRun(api, projectId, runId)
      .then((r) => !cancelled && setRun(r))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, projectId, runId]);

  const survey = run ? surveys.find((s) => s.maps.some((m) => m.id === run.map_id)) : undefined;
  const mapName = run ? survey?.maps.find((m) => m.id === run.map_id)?.name : undefined;
  const decide = (action: ReviewAction, classId?: string) => {
    if (d) void review.decide(runId, d, action, classId, kindOf);
  };
  const back = () => {
    const prev = useDetectStore.getState().popHistory();
    if (prev) select(prev);
  };
  // Off while the finding-delete confirm or the type picker is up: A / X must not act behind a dialog.
  useToolShortcuts(
    [
      { shortcut: "A", action: "accept", onTrigger: () => decide("accept"), disabled: !d },
      { shortcut: "X", action: "reject", onTrigger: () => decide("reject"), disabled: !d },
      { shortcut: "Shift+A", action: "accept-all", onTrigger: () => void review.decideMany("accept") },
      { shortcut: "Shift+X", action: "reject-all", onTrigger: () => void review.decideMany("reject") },
      { shortcut: "T", action: "type-picker", onTrigger: () => setPicking(true), disabled: !d },
      {
        shortcut: "Tab",
        action: "next-pending",
        onTrigger: () => void review.advance(runId, d?.id ?? null),
      },
      { shortcut: "Shift+Tab", action: "previous-pending", onTrigger: back },
    ],
    !review.confirm && !picking,
  );

  if (!d)
    return (
      <InspectorPane label="Detection">
        <p className="text-sm text-muted">
          This detection is not loaded. Pan to it on the map, or press Tab for the next one to review.
        </p>
      </InspectorPane>
    );

  const t = types.get(d.class_id);
  const state = REVIEW_STATE[d.review_state];
  const jump = d.corners_site && survey ? openIn3d(...boxCentre(d.corners_site), survey.date) : null;
  return (
    <>
      <InspectorPane
        label="Detection"
        header={
          <div className="flex w-full items-center gap-2" data-testid="detection-inspector">
            {t ? (
              <TypeChip name={t.name} colour={t.colour} kind={t.kind} />
            ) : (
              <span className="text-sm">Unknown type</span>
            )}
            <span className="flex-1" />
            <span className="text-sm tabular-nums text-muted">{Math.round(d.confidence * 100)} %</span>
            <Pill size="sm" tone={state.tone}>
              {state.label}
            </Pill>
          </div>
        }
        footer={
          <p className="text-xs text-muted">
            <KeyChord chord="A" /> accept · <KeyChord chord="X" /> reject · <KeyChord chord="T" /> type ·{" "}
            <KeyChord chord="Tab" /> next
          </p>
        }
      >
        <InspectorSection key="facts" title="Detection">
          <div data-testid="review-current" data-id={d.id}>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted">Model</dt>
              <dd className="truncate">
                {run?.model_name ?? run?.provider ?? "—"}
                {run?.scope === "region" ? " · region run" : ""}
              </dd>
              <dt className="text-muted">Map</dt>
              <dd className="truncate">
                {survey ? `${mapName ?? "Orthomosaic"} · ${formatSurveyDate(survey.date)}` : "—"}
              </dd>
            </dl>
          </div>
        </InspectorSection>
        <InspectorSection key="review" title="Review">
          <div className="grid grid-cols-3 gap-1.5">
            <Button size="sm" variant="primary" loading={review.busy} onClick={() => decide("accept")}>
              Accept
            </Button>
            <Button size="sm" onClick={() => decide("reject")}>
              Reject
            </Button>
            <Button size="sm" variant="ghost" ref={typeButton} onClick={() => setPicking(true)}>
              Type…
            </Button>
          </div>
          {!isPending(d) && d.review_state !== "rejected" && (
            <Button size="sm" variant="ghost" className="mt-1.5" onClick={() => decide("unreview")}>
              Back to not reviewed
            </Button>
          )}
          {t?.kind === "defect" && isPending(d) && (
            <p className="mt-1.5 text-xs text-muted">Accepting a defect creates a finding.</p>
          )}
        </InspectorSection>
        <InspectorSection key="3d" title="3D">
          {jump?.href ? (
            <Button size="sm" variant="secondary" onClick={() => navigate(jump.href)}>
              Open in 3D
            </Button>
          ) : (
            <p className="text-xs text-muted">
              {jump && jump.href === null ? jump.reason : "No point cloud for this map."}
            </p>
          )}
        </InspectorSection>
      </InspectorPane>
      <Popover open={picking} onClose={() => setPicking(false)} anchorRef={typeButton} label="Pick the type">
        <ComboboxList
          label="Type"
          items={all.map((c) => ({
            id: c.id,
            label: c.name,
            colour: c.colour,
            hotkey: c.hotkey,
            hint: c.kind === "defect" ? "Defect" : "Object",
          }))}
          value={d.class_id}
          onSelect={(typeId) => {
            setPicking(false);
            if (typeId !== d.class_id) decide("reclass", typeId);
          }}
        />
      </Popover>
      <ConfirmFindingDelete
        confirm={review.confirm}
        onConfirm={() => void review.confirmDelete()}
        onCancel={review.cancelConfirm}
      />
    </>
  );
}
