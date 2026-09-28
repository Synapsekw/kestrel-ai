import { create } from "zustand";

export interface Marker {
  px: number;
  py: number;
  r: number;
}

interface ArrivalState {
  imageId: string | null;
  marker: Marker | null;
  cloudId: string | null;
  /**
   * Amendment (IMC reconciliation item 9): `marker` is null for a back-only arrival
   * (`{kind: "back", cloudId}` — a photo found by distance with no pixel). `ArrivalMarker` and
   * `ArrivalProbe` then render nothing; `BackTo3DChip` still shows because `cloudId` is set.
   */
  arrive: (imageId: string, marker: Marker | null, cloudId: string | null) => void;
  /** Esc: the ring goes, the Back to 3D chip stays (Ruling 8). */
  clearMarker: () => void;
  /** Another image opened: both go. */
  leave: (imageId: string | null) => void;
}

export const useArrivalStore = create<ArrivalState>((set) => ({
  imageId: null,
  marker: null,
  cloudId: null,
  arrive: (imageId, marker, cloudId) => set({ imageId, marker, cloudId }),
  clearMarker: () => set({ marker: null }),
  leave: (imageId) =>
    set((s) =>
      s.imageId !== null && s.imageId !== imageId ? { imageId: null, marker: null, cloudId: null } : s,
    ),
}));
