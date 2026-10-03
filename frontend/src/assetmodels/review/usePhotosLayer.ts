// src/assetmodels/review/usePhotosLayer.ts
// The cameras layer (spec §9 Photos): the model's poses, paged (2,000 a page, Review Focus 5), as
// one instanced glyph set in the viewer, filtered and coloured by outcome. Lives in the workspace
// so the glyphs stay in the view whatever rail topic is open.
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { usePoses } from "@/api/assetReview";
import { cameraPosesFrom, type CameraPose } from "@/assetmodels/viewer/cameras";
import type { ModelViewerHandle } from "@/assetmodels/viewer/ModelViewer";
import {
  filterPoses,
  outcomeColours,
  outcomeCounts,
  outcomeKey,
  sequencesOf,
  type OutcomeKey,
} from "./outcome";

const EMPTY: CameraPose[] = [];

export interface PhotosLayer {
  loaded: number;
  done: boolean;
  error: string | null;
  reload(): void;
  shown: CameraPose[];
  counts: Record<OutcomeKey, number>;
  sequences: string[];
  colours: Record<OutcomeKey, string>;
  sequence: string | null;
  setSequence(s: string | null): void;
  includeContext: boolean;
  setIncludeContext(on: boolean): void;
  camerasOn: boolean;
  setCamerasOn(on: boolean): void;
  cone: boolean;
  setCone(on: boolean): void;
  selected: CameraPose | null;
  select(imageId: string | null): void;
  viewing: boolean;
  viewFrom(p: CameraPose | null): void;
  push(): void;
}

export function usePhotosLayer(
  projectId: string,
  modelId: string,
  viewer: RefObject<ModelViewerHandle | null>,
): PhotosLayer {
  const poses = usePoses(projectId, modelId);
  const all = useMemo(() => cameraPosesFrom(poses.items), [poses.items]);
  const [sequence, setSequence] = useState<string | null>(null);
  const [includeContext, setIncludeContext] = useState(false);
  const [camerasOn, setCamerasOn] = useState(true);
  const [cone, setCone] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  const shown = useMemo(
    () => filterPoses(all, { sequence, includeContext }),
    [all, sequence, includeContext],
  );
  const counts = useMemo(() => outcomeCounts(shown), [shown]);
  const sequences = useMemo(() => sequencesOf(all), [all]);
  const colours = useMemo(() => outcomeColours(), []);
  const selected = useMemo(() => all.find((p) => p.imageId === selectedId) ?? null, [all, selectedId]);

  const cameras = camerasOn ? shown : EMPTY;
  const sent = useRef<{ list: readonly CameraPose[]; colours: Record<OutcomeKey, string> } | null>(null);

  // Every setCameras rebuilds the glyph set, so it waits for the last page and then goes once per change.
  const done = poses.done;
  useEffect(() => {
    const v = viewer.current;
    if (!done || !v) return;
    const s = sent.current;
    if (s && s.list === cameras && s.colours === colours) return;
    sent.current = { list: cameras, colours };
    v.setCameras(cameras, (p) => colours[outcomeKey(p.outcome)]);
  }, [viewer, done, cameras, colours]);

  useEffect(() => {
    viewer.current?.setSelectedCamera(camerasOn ? selectedId : null, cone);
  }, [viewer, camerasOn, selectedId, cone]);

  // A fresh viewer (after a reload) needs everything again, whatever was sent before.
  const push = () => {
    const v = viewer.current;
    if (!v) return;
    sent.current = { list: cameras, colours };
    v.setCameras(cameras, (p) => colours[outcomeKey(p.outcome)]);
    v.setSelectedCamera(camerasOn ? selectedId : null, cone);
  };

  const viewFrom = (p: CameraPose | null) => {
    setViewing(p !== null);
    viewer.current?.viewFromPose(p);
  };

  return {
    loaded: all.length,
    done: poses.done,
    error: poses.error,
    reload: poses.reload,
    shown,
    counts,
    sequences,
    colours,
    sequence,
    setSequence,
    includeContext,
    setIncludeContext,
    camerasOn,
    setCamerasOn,
    cone,
    setCone,
    selected,
    select: setSelectedId,
    viewing,
    viewFrom,
    push,
  };
}
