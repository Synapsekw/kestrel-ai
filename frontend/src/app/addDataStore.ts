import { create } from "zustand";

/** The importers behind Add data (spec section 6.4); the Maps workspace adds Drawing (M §8.2). */
export type AddDataTile = "photos" | "orthomosaic" | "elevation" | "point_cloud" | "drawing" | "review";

interface AddDataState {
  open: boolean;
  /** The importer to open directly; null shows the chooser. */
  tile: AddDataTile | null;
  /** The shell's loaded project, the one Add data imports into; null while it loads or cannot load. */
  projectId: string | null;
  show: (tile: AddDataTile | null) => void;
  close: () => void;
  /** Called by the host: a different project (or none) closes Add data, so it never follows into another. */
  setProject: (projectId: string | null) => void;
}

export const useAddData = create<AddDataState>((set) => ({
  open: false,
  tile: null,
  projectId: null,
  show: (tile) => set({ open: true, tile }),
  close: () => set({ open: false, tile: null }),
  setProject: (projectId) =>
    set((s) => (s.projectId === projectId ? s : { projectId, open: false, tile: null })),
}));
