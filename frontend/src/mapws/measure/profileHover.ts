import { create } from "zustand";

/** The hovered profile station, shared by the chart and the map line (spec §9.2). */
interface ProfileHoverState {
  measurementId: string | null;
  index: number | null;
  set: (measurementId: string | null, index: number | null) => void;
}

export const useProfileHover = create<ProfileHoverState>((set) => ({
  measurementId: null,
  index: null,
  set: (measurementId, index) => set({ measurementId, index }),
}));
