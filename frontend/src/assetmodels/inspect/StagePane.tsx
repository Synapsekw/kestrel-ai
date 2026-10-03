// A ModelViewer fed with the finding's context: the placements (patches load when visible), the
// cameras of this finding's sightings with the current one's view cone, and either a focus on the
// finding (the left stage), a photo pose (View from pose) or a preset (Model mode).
import { useCallback, useEffect, useMemo, useRef } from "react";
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
  const running = useRef(false);
  const apply = useCallback(() => {
    const v = viewer.current;
    if (!v || !running.current) return;
    v.setPlacements(items, fetchPatch);
    v.setCameras(cameras, () => colour);
    v.setSelectedCamera(selectedImageId, aim.kind === "focus");
    // The replay state keeps auto-rotate on and viewFromPose does not stop it, so stop it here.
    v.setAutoRotate(false);
    if (aim.kind === "focus") v.focusFinding(aim.findingId, aim.settings);
    else v.viewFromPose(aim.pose);
  }, [items, fetchPatch, cameras, colour, selectedImageId, aim]);
  useEffect(apply, [apply]);
  const onState = useCallback(
    (s: ModelViewState) => {
      running.current = s === "running";
      apply();
    },
    [apply],
  );
  const noop = useMemo(() => () => {}, []);
  return (
    <div data-testid={testId} className="relative flex h-full w-full">
      {glbUrl && (
        <ModelViewer ref={viewer} glbUrl={glbUrl} onParts={noop} onSelect={noop} onState={onState} />
      )}
    </div>
  );
}
