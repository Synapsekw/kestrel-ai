// A ModelViewer fed with the finding's context: the placements (patches load when visible), the
// cameras of this finding's sightings with the current one's view cone, and either a focus on the
// finding (the left stage), a photo pose (View from pose) or a preset (Model mode).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CameraPose } from "@/assetmodels/viewer/cameras";
import type { FocusSettings } from "@/assetmodels/viewer/focus";
import { ModelViewer, type ModelViewerHandle, type ModelViewState } from "@/assetmodels/viewer/ModelViewer";
import type { FetchPatch, PlacementItem } from "@/assetmodels/viewer/placements";

export type StageAim =
  | { kind: "focus"; findingId: string; settings?: FocusSettings }
  | { kind: "pose"; pose: CameraPose | null }
  | { kind: "preset"; pose: CameraPose | null };

export function StagePane({
  glbUrl,
  items,
  fetchPatch,
  cameras,
  colour,
  selectedImageId,
  aim,
  testId,
}: {
  glbUrl: string | null;
  items: PlacementItem[];
  fetchPatch: FetchPatch;
  cameras: CameraPose[];
  colour: string;
  selectedImageId: string | null;
  /** Memoise it in the caller: a new object each render would re-aim on every render. */
  aim: StageAim;
  testId: string;
}) {
  const viewer = useRef<ModelViewerHandle>(null);
  const [running, setRunning] = useState(false);
  // The last aim applied and whether it took: a focus with no placement yet (they page in late)
  // is tried again when the placements change, never after it succeeded.
  const aimed = useRef<{ aim: StageAim; ok: boolean } | null>(null);
  const applyAim = useCallback((a: StageAim) => {
    const v = viewer.current;
    if (!v) return;
    // The replay state keeps auto-rotate on and neither call stops it reliably, so stop it first.
    v.setAutoRotate(false);
    let ok = true;
    if (a.kind === "focus") ok = v.focusFinding(a.findingId, a.settings);
    else v.viewFromPose(a.pose);
    aimed.current = { aim: a, ok };
  }, []);

  // One effect per concern, so stepping a sighting neither rebuilds the patches nor re-aims the
  // camera the operator may have orbited. Each runs once more when the viewer reaches "running".
  useEffect(() => {
    if (!running) return;
    viewer.current?.setPlacements(items, fetchPatch);
    const last = aimed.current;
    if (last && !last.ok) applyAim(last.aim);
  }, [running, items, fetchPatch, applyAim]);
  useEffect(() => {
    if (running) viewer.current?.setCameras(cameras, () => colour);
  }, [running, cameras, colour]);
  const followSelected = aim.kind === "focus";
  useEffect(() => {
    if (running) viewer.current?.setSelectedCamera(selectedImageId, followSelected);
  }, [running, selectedImageId, followSelected]);
  useEffect(() => {
    if (running) applyAim(aim);
  }, [running, aim, applyAim]);

  const onState = useCallback((s: ModelViewState) => {
    if (s !== "running") aimed.current = null;
    setRunning(s === "running");
  }, []);
  const noop = useMemo(() => () => {}, []);
  return (
    <div data-testid={testId} className="relative flex h-full w-full">
      {glbUrl && (
        <ModelViewer ref={viewer} glbUrl={glbUrl} onParts={noop} onSelect={noop} onState={onState} />
      )}
    </div>
  );
}
