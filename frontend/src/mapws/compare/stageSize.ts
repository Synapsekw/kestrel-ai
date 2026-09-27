import { create } from "zustand";

/** The stage's CSS size, measured by CompareStage (W1's stage slot is `absolute inset-0`). */
export const useStageSize = create<{
  size: [number, number] | null;
  setSize: (s: [number, number]) => void;
}>((set) => ({
  size: null,
  setSize: (size) => set({ size }),
}));
