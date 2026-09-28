import { create } from "zustand";
import type { CloudCameraSet } from "@contract/client";
import { applyOffset, type CamerasStatus } from "./cameraMath";

/** The open cloud's cameras payload, shared by the panel row, the glyphs, the tool, the arrival and LikelyViews. */
export interface CamerasState {
  cloudId: string | null;
  status: CamerasStatus;
  set: CloudCameraSet | null;
  error: string | null;
  /** The "Show camera positions" switch: null until the operator touches it (then on when any camera exists). */
  visible: boolean | null;
  lookingThrough: boolean;
  /** Bumped to ask `useCloudCameras` for a refetch (after a failed offset save, to drop the preview). */
  reloadTick: number;
  /** Clears the payload and the operator's switch choice; `visible` is reset per cloud open. */
  reset(cloudId: string | null): void;
  reload(): void;
  setVisible(v: boolean): void;
  setLookingThrough(v: boolean): void;
  /** Stores a payload only when it belongs to the cloud the store is for. */
  receive(cloudId: string, set: CloudCameraSet): void;
  fail(cloudId: string, status: "needs_coordinates" | "error", error: string | null): void;
  applyLocalOffset(sourceIdx: number, offsetM: number): void;
}

export const useCamerasStore = create<CamerasState>((set, get) => ({
  cloudId: null,
  status: "idle",
  set: null,
  error: null,
  visible: null,
  lookingThrough: false,
  reloadTick: 0,
  reset: (cloudId) =>
    set({
      cloudId,
      status: cloudId ? "loading" : "idle",
      set: null,
      error: null,
      visible: null,
      lookingThrough: false,
    }),
  reload: () => set((s) => ({ reloadTick: s.reloadTick + 1 })),
  setVisible: (visible) => set({ visible }),
  setLookingThrough: (lookingThrough) => set({ lookingThrough }),
  receive: (cloudId, payload) => {
    if (get().cloudId === cloudId) set({ status: "ready", set: payload, error: null });
  },
  fail: (cloudId, status, error) => {
    if (get().cloudId === cloudId) set({ status, set: null, error });
  },
  applyLocalOffset: (sourceIdx, offsetM) => {
    const cur = get().set;
    if (cur) set({ set: applyOffset(cur, sourceIdx, offsetM) });
  },
}));

export function camerasShown(s: Pick<CamerasState, "visible" | "set">): boolean {
  return (s.visible ?? true) && !!s.set && s.set.image_id.length > 0;
}
