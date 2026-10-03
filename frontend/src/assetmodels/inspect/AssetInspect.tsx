// Split inspection (asset findings spec §9): /p/:projectId/models/:modelId/inspect?finding=&sighting=
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { assetModelGlbUrl } from "@contract/client";
import {
  fetchPatchBuffers,
  useAssetFindings,
  usePlacements,
  usePoses,
  useSightings,
} from "@/api/assetReview";
import { useApi, useBackend } from "@/api/client";
import { fetchFinding, type Finding } from "@/api/findings";
import { useAssetModelList } from "@/assetmodels/useAssetModels";
import { cameraPosesFrom, type CameraPose } from "@/assetmodels/viewer/cameras";
import type { FocusSettings } from "@/assetmodels/viewer/focus";
import { placementItems } from "@/assetmodels/viewer/placements";
import { tokenRgb } from "@/clouds/viewer/overlay";
import { formatFindingNumber } from "@/findings/format";
import { useProjectTypes } from "@/findings/useProjectTypes";
import { useImagesWorkspace } from "@/store/imagesWorkspace";
import {
  Alert,
  Button,
  EmptyState,
  GlassPanel,
  Segmented,
  Skeleton,
  Slider,
  WORKSPACE_KEYS,
  useSeverityScale,
  useToolShortcuts,
} from "@/ui";
import { FindingActions } from "./FindingActions";
import { InspectHud } from "./InspectHud";
import { currentSighting, stepId } from "./nav";
import { PhotoPane } from "./PhotoPane";
import { readSplit, writeSplit } from "./split";
import { Splitter } from "./Splitter";
import { StagePane, type StageAim } from "./StagePane";
import { useHoldKey } from "./useHoldKey";

type Mode = "photo" | "pose" | "model";
const MODES: { value: Mode; label: string }[] = [
  { value: "photo", label: "Photo" },
  { value: "pose", label: "View from pose" },
  { value: "model", label: "Model" },
];
const keyOf = (action: string) => WORKSPACE_KEYS.inspect.find((k) => k.action === action)?.keys[0];
const rgb = (t: string) => `rgb(${tokenRgb(t).join(", ")})`;

type Focus = { frustum: number[]; oblique_deg?: number | null };
type FramePreset = { id: string; label: string; target: number[]; camera: number[] };

/** The left stage's aim: a stable object that changes only with the finding or the profile's focus. */
function useFocusAim(findingId: string | null, focus: Focus | undefined): StageAim {
  const frustum0 = focus?.frustum[0];
  const frustum1 = focus?.frustum[1];
  const oblique = focus?.oblique_deg ?? 0;
  return useMemo<StageAim>(() => {
    const settings: FocusSettings | undefined =
      frustum0 === undefined || frustum1 === undefined
        ? undefined
        : { frustum: [frustum0, frustum1], oblique_deg: oblique };
    return { kind: "focus", findingId: findingId ?? "", settings };
  }, [findingId, frustum0, frustum1, oblique]);
}

/** The frame's view presets as camera poses (50 degree look, no photo). */
function usePresetPoses(presets: readonly FramePreset[] | undefined): CameraPose[] {
  return useMemo<CameraPose[]>(
    () =>
      (presets ?? []).map((p) => ({
        imageId: `preset:${p.id}`,
        position: [p.camera[0], p.camera[1], p.camera[2]],
        target: [p.target[0], p.target[1], p.target[2]],
        up: [0, 1, 0],
        hfovDeg: 50,
        vfovDeg: 38,
        sequence: p.label,
        outcome: null,
      })),
    [presets],
  );
}

export function AssetInspect() {
  const { projectId = "", modelId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const findingId = params.get("finding");
  const wantedSighting = params.get("sighting");
  const api = useApi();
  const backend = useBackend();
  const scale = useSeverityScale();
  const { all: types } = useProjectTypes(projectId);
  const typeName = useCallback((id: string) => types.find((t) => t.id === id)?.name, [types]);

  const { models } = useAssetModelList(projectId);
  const model = models?.find((m) => m.id === modelId) ?? null;
  const glbUrl =
    model?.current_version != null
      ? assetModelGlbUrl(backend.baseUrl, backend.token, projectId, modelId, model.current_version)
      : null;

  const list = useAssetFindings(projectId, modelId, { sort: "-severity" });
  const listed = list.items.find((f) => f.id === findingId) ?? null;
  const [fetched, setFetched] = useState<{ id: string; finding: Finding | null } | null>(null);
  useEffect(() => {
    if (!findingId || listed || !list.done) return;
    let live = true;
    fetchFinding(api, projectId, findingId).then(
      (f) => live && setFetched({ id: findingId, finding: f.asset_model_id === modelId ? f : null }),
      () => live && setFetched({ id: findingId, finding: null }),
    );
    return () => {
      live = false;
    };
  }, [api, projectId, modelId, findingId, listed, list.done]);
  const finding = listed ?? (fetched?.id === findingId ? fetched.finding : null);
  const missing = !listed && list.done && fetched?.id === findingId && fetched.finding === null;

  const { sightings } = useSightings(projectId, findingId);
  const current = currentSighting(sightings ?? [], wantedSighting);
  const index = current && sightings ? sightings.indexOf(current) : 0;

  const go = useCallback(
    (next: { finding?: string; sighting?: string | null }) => {
      const p = new URLSearchParams(params);
      if (next.finding !== undefined) {
        p.set("finding", next.finding);
        p.delete("sighting");
      }
      if (next.sighting) p.set("sighting", next.sighting);
      setParams(p, { replace: true });
    },
    [params, setParams],
  );
  const ids = useMemo(() => list.items.map((f) => f.id), [list.items]);
  const sightingIds = useMemo(() => (sightings ?? []).map((s) => s.id), [sightings]);
  const stepFinding = (dir: 1 | -1) => {
    const id = stepId(ids, findingId, dir);
    if (id) go({ finding: id });
  };
  const stepSighting = (dir: 1 | -1) => {
    const id = stepId(sightingIds, current?.id ?? null, dir);
    if (id) go({ sighting: id });
  };
  useToolShortcuts([
    { shortcut: keyOf("previous-sighting"), action: "previous-sighting", onTrigger: () => stepSighting(-1) },
    { shortcut: keyOf("next-sighting"), action: "next-sighting", onTrigger: () => stepSighting(1) },
    { shortcut: keyOf("next-finding"), action: "next-finding", onTrigger: () => stepFinding(1) },
    { shortcut: keyOf("previous-finding"), action: "previous-finding", onTrigger: () => stepFinding(-1) },
  ]);

  const [split, setSplit] = useState(readSplit);
  const onSplit = (v: number) => {
    setSplit(v);
    writeSplit(v);
  };
  const [mode, setMode] = useState<Mode>("photo");
  const [opacity, setOpacity] = useState(55);
  const [comparing, setComparing] = useState(false);
  useHoldKey("Space", setComparing, mode === "photo");

  // The stage's data: placements of the model, cameras of this finding's sightings only.
  const placements = usePlacements(projectId, modelId);
  const items = useMemo(
    () => placementItems(placements.items, scale, rgb("muted")),
    [placements.items, scale],
  );
  const fetchPatch = useMemo(
    () => fetchPatchBuffers(backend, projectId, modelId),
    [backend, projectId, modelId],
  );
  const poses = usePoses(projectId, modelId);
  const allPoses = useMemo(() => cameraPosesFrom(poses.items), [poses.items]);
  const seenFrom = useMemo(() => new Set((sightings ?? []).map((s) => s.image_id)), [sightings]);
  const cameras = useMemo(() => allPoses.filter((p) => seenFrom.has(p.imageId)), [allPoses, seenFrom]);
  const currentImageId = current?.image_id ?? null;
  const currentPose = allPoses.find((p) => p.imageId === currentImageId) ?? null;
  const accent = useMemo(() => rgb("accent"), []);
  const stageAim = useFocusAim(findingId, model?.review?.focus);
  const [preset, setPreset] = useState<CameraPose | null>(null);
  const presets = usePresetPoses(model?.frame?.presets);
  const rightAim = useMemo<StageAim>(
    () => (mode === "pose" ? { kind: "pose", pose: currentPose } : { kind: "preset", pose: preset }),
    [mode, currentPose, preset],
  );
  const captureTime = useImagesWorkspace((s) =>
    s.image?.id === current?.image_id ? s.image?.capture_time : null,
  );

  if (!findingId)
    return (
      <div data-testid="asset-inspect" className="grid h-full place-items-center p-6">
        <EmptyState icon="findings" title="No finding chosen">
          Open a finding from the asset model&apos;s Findings topic or from the register.
        </EmptyState>
      </div>
    );
  if (missing)
    return (
      <div data-testid="asset-inspect" className="grid h-full place-items-center p-6">
        <EmptyState
          icon="findings"
          title="This finding is not on this asset model"
          action={
            <Link
              className="text-sm text-accent-ink hover:underline"
              to={`/p/${projectId}/models/${modelId}`}
            >
              Back to the model
            </Link>
          }
        >
          It may have been merged, split or deleted.
        </EmptyState>
      </div>
    );

  return (
    <div data-testid="asset-inspect" className="relative flex h-full min-h-0 w-full bg-bg">
      <h1 className="sr-only">
        {finding ? `Inspect ${formatFindingNumber(finding.number)}` : "Inspect a finding"}
      </h1>
      <section aria-label="Asset model" className="relative h-full min-w-0" style={{ width: `${split}%` }}>
        <StagePane
          testId="inspect-stage"
          glbUrl={glbUrl}
          items={items}
          fetchPatch={fetchPatch}
          cameras={cameras}
          colour={accent}
          selectedImageId={current?.image_id ?? null}
          aim={stageAim}
        />
        <GlassPanel
          variant="float"
          radius="control"
          className="absolute left-3.5 top-3.5 z-10 flex items-center gap-1.5 p-1.5"
        >
          <Link
            to={`/p/${projectId}/models/${modelId}`}
            className="rounded-control px-2 text-sm text-accent-ink hover:underline"
          >
            Back to the model
          </Link>
          <Button
            size="sm"
            variant="ghost"
            icon="chevron-left"
            disabled={!stepId(ids, findingId, -1)}
            onClick={() => stepFinding(-1)}
          >
            Previous finding
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="chevron-right"
            disabled={!stepId(ids, findingId, 1)}
            onClick={() => stepFinding(1)}
          >
            Next finding
          </Button>
        </GlassPanel>
      </section>
      <Splitter value={split} onChange={onSplit} />
      <section aria-label="Photo" className="relative h-full min-w-0 flex-1">
        {mode === "photo" ? (
          current ? (
            <PhotoPane
              projectId={projectId}
              imageId={current.image_id}
              sightings={sightings ?? []}
              opacity={opacity / 100}
              comparing={comparing}
            />
          ) : sightings && sightings.length === 0 ? (
            <div className="grid h-full place-items-center p-6">
              <Alert tone="info">This finding has no sightings left. It stays in the register, closed.</Alert>
            </div>
          ) : (
            <div role="status" aria-label="Loading the sightings" className="grid h-full place-items-center">
              <Skeleton className="h-40 w-56 rounded-panel" />
            </div>
          )
        ) : (
          <StagePane
            testId="inspect-right-stage"
            glbUrl={glbUrl}
            items={items}
            fetchPatch={fetchPatch}
            cameras={mode === "pose" ? [] : cameras}
            colour={accent}
            selectedImageId={null}
            aim={rightAim}
          />
        )}
        {mode === "pose" && !currentPose && poses.done && (
          <div className="absolute inset-x-4 top-16 z-10">
            <Alert tone="warn">
              This photo has no pose yet. Estimate the poses in the asset model&apos;s Photos topic.
            </Alert>
          </div>
        )}
        <GlassPanel
          variant="float"
          radius="control"
          className="absolute right-3.5 top-3.5 z-10 flex flex-wrap items-center gap-3 p-1.5"
        >
          <Segmented size="sm" label="Right pane" options={MODES} value={mode} onChange={setMode} />
          {mode === "photo" && (
            <>
              <Slider
                className="w-40"
                label="Overlay opacity"
                min={0}
                max={100}
                step={5}
                value={opacity}
                onChange={setOpacity}
                format={(v) => `${v}%`}
              />
              <Button
                size="sm"
                variant="ghost"
                icon="eye-off"
                aria-pressed={comparing}
                onPointerDown={() => setComparing(true)}
                onPointerUp={() => setComparing(false)}
                onPointerLeave={() => setComparing(false)}
              >
                Hold to compare
              </Button>
            </>
          )}
          {mode === "model" &&
            (presets.length > 0 ? (
              presets.map((p) => (
                <Button
                  key={p.imageId}
                  size="sm"
                  variant={preset?.imageId === p.imageId ? "primary" : "ghost"}
                  onClick={() => setPreset(p)}
                >
                  {p.sequence}
                </Button>
              ))
            ) : (
              <span className="text-xs text-muted">This model has no view presets.</span>
            ))}
        </GlassPanel>
        {finding && (
          <InspectHud
            finding={finding}
            typeName={typeName(finding.type_id)}
            zone={model?.review?.zones?.find((z) => z.id === finding.zone)?.label ?? finding.zone ?? null}
            captureTime={captureTime}
            index={index}
            count={sightings?.length ?? 0}
          />
        )}
        {finding && (
          <GlassPanel
            variant="float"
            radius="control"
            className="absolute bottom-3.5 right-3.5 z-10 flex flex-wrap items-center gap-1.5 p-1.5"
          >
            <Button
              size="sm"
              variant="ghost"
              icon="arrow-left"
              disabled={!stepId(sightingIds, current?.id ?? null, -1)}
              onClick={() => stepSighting(-1)}
            >
              Previous sighting
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon="arrow-right"
              disabled={!stepId(sightingIds, current?.id ?? null, 1)}
              onClick={() => stepSighting(1)}
            >
              Next sighting
            </Button>
            <FindingActions
              projectId={projectId}
              finding={finding}
              sightings={sightings ?? []}
              current={current}
              others={list.items}
              typeName={typeName}
              onGo={(id) => go({ finding: id })}
            />
          </GlassPanel>
        )}
      </section>
    </div>
  );
}
