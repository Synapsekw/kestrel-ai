import { useCallback, useState, type RefObject } from "react";
import { useApi } from "@/api/client";
import { createCloudFinding, moveCloudFinding } from "@/api/cloudFindings";
import { messageOf } from "@/api/errors";
import type { CloudPick, CloudViewerHandle } from "@/clouds/CloudViewer";
import type { Vec3 } from "@/clouds/viewer/types";
import { setAnchorNormal } from "@/clouds/views/normals";
import type { WorkspaceSeams } from "@/clouds/workspace/seams";
import { formatFindingNumber } from "@/findings/format";
import { ownFindingsWrite } from "@/store/changesOwnWrite";
import { useChangesStore } from "@/store/changes";
import { toast } from "@/ui";
import type { PinDraftInput } from "./PinCallout";
import type { DraftPin } from "./types";

export const LAST_TYPE_KEY = "kestrel.clouds.lastPinType";

export function readLastType(): string | null {
  try {
    return localStorage.getItem(LAST_TYPE_KEY);
  } catch {
    return null;
  }
}

export function writeLastType(id: string): void {
  try {
    localStorage.setItem(LAST_TYPE_KEY, id);
  } catch {
    // a blocked store only loses the preselection
  }
}

/** Spec §9.1 via C-V2 (P1 ruling a): the PCA normal of the pick window at the picked point's screen spot. */
export function normalAt(viewer: CloudViewerHandle | null, p: CloudPick): Vec3 | null {
  if (!viewer) return null;
  const s = viewer.project({ x: p.x, y: p.y, z: p.z });
  if (!s) return null;
  // T7-4: a capture running can make `pickWithNormal` answer null; the pick still stands as the
  // anchor with a null normal (never dimmed by the facing test).
  return viewer.pickWithNormal(s.x, s.y)?.normal ?? null;
}

export interface PinToolOptions {
  projectId: string;
  cloudId: string | null;
  viewer: RefObject<CloudViewerHandle | null>;
  /** Called with the new finding's id after Create succeeds (select it, pulse it). */
  onCreated: (id: string) => void;
  /** The workspace seams, from `FeatureContext.seams`: this hook runs inside `usePinsFeature`, above
   * `WorkspaceSeamsContext.Provider` (T7-1), so `useWorkspaceSeams()` would return the no-op defaults. */
  seams: WorkspaceSeams;
}

export interface PinTool {
  draft: DraftPin | null;
  /** The finding whose anchor the next pick moves (Move pin), or null. */
  moving: string | null;
  busy: boolean;
  /** A canvas pick while the pin tool is armed or Move pin is waiting. */
  pick: (p: CloudPick) => void;
  create: (v: PinDraftInput) => Promise<string | null>;
  /**
   * Discards the draft or the pending move. Returns true when a draft was dropped (the pin tool
   * should stay armed for a repeat pin) and false when there was nothing to cancel, or a pending
   * move was cancelled (T7-3: Move pin started from Orbit, so W1 arms Orbit again on false).
   */
  cancel: () => boolean;
  startMove: (id: string) => void;
}

/** Spec §9.4: the draft flow, Create through F's POST, Move pin through F's PATCH, then the capture request. */
export function usePinTool({ projectId, cloudId, viewer, onCreated, seams }: PinToolOptions): PinTool {
  const api = useApi();
  // Keyed by cloud, so a cloud switch drops a draft or a pending move without an effect.
  const [draftState, setDraftState] = useState<{ cloudId: string; draft: DraftPin } | null>(null);
  const [movingState, setMovingState] = useState<{ cloudId: string; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const draft = draftState && draftState.cloudId === cloudId ? draftState.draft : null;
  const moving = movingState && movingState.cloudId === cloudId ? movingState.id : null;

  const move = useCallback(
    async (id: string, p: CloudPick, normal: Vec3 | null) => {
      setBusy(true);
      try {
        // G5/T7-2: a known-id write goes through `ownFindingsWrite`; it bumps `findingsRevision`
        // itself (on success, and on failure with `bumpOnError`), so no trailing bump here.
        await ownFindingsWrite(
          [id],
          () =>
            moveCloudFinding(api, projectId, id, { x: p.x, y: p.y, z: p.z, uncertainty_m: p.uncertainty_m }),
          { bumpOnError: true, onSaved: () => setAnchorNormal(id, normal) },
        );
        seams.requestViewCapture({ kind: "finding", id }, "move");
        toast("ok", "Pin moved");
      } catch (e) {
        toast("danger", messageOf(e, "could not move the pin"));
      } finally {
        setBusy(false);
      }
    },
    [api, projectId, seams],
  );

  const pick = useCallback(
    (p: CloudPick) => {
      if (!cloudId) return;
      const normal = normalAt(viewer.current, p);
      if (moving) {
        setMovingState(null);
        void move(moving, p, normal);
        return;
      }
      setDraftState({ cloudId, draft: { p: [p.x, p.y, p.z], u: p.uncertainty_m, normal } });
    },
    [cloudId, viewer, moving, move],
  );

  const create = useCallback(
    async (v: PinDraftInput): Promise<string | null> => {
      if (!draft || !cloudId || busy) return null;
      setBusy(true);
      try {
        const f = await createCloudFinding(api, projectId, {
          type_id: v.typeId,
          anchor: { cloud_id: cloudId, x: draft.p[0], y: draft.p[1], z: draft.p[2], uncertainty_m: draft.u },
          severity: v.severity,
          note: v.note,
        });
        setAnchorNormal(f.id, draft.normal); // before the capture: R1's upload reads it (controller hand-off)
        seams.requestViewCapture({ kind: "finding", id: f.id }, "create");
        writeLastType(v.typeId);
        setDraftState(null);
        useChangesStore.getState().bumpFindings();
        onCreated(f.id);
        toast("ok", `${formatFindingNumber(f.number)} created`);
        return f.id;
      } catch (e) {
        toast("danger", messageOf(e, "could not create the finding"));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [api, projectId, cloudId, draft, busy, seams, onCreated],
  );

  const cancel = useCallback((): boolean => {
    if (draft) {
      setDraftState(null);
      return true;
    }
    if (moving) {
      // T7-3: Move pin arms the pin tool from Orbit (Ruling 15); cancelling it should return to
      // Orbit, not stay armed for a fresh pin.
      setMovingState(null);
      return false;
    }
    return false;
  }, [draft, moving]);

  const startMove = useCallback(
    (id: string) => {
      if (!cloudId) return;
      setDraftState(null);
      setMovingState({ cloudId, id });
    },
    [cloudId],
  );

  return { draft, moving, busy, pick, create, cancel, startMove };
}
