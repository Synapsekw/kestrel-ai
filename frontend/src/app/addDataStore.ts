import { create } from "zustand";

/** The importers behind Add data (spec section 6.4); Drawing arrives with the Maps workspace. */
export type AddDataTile = "photos" | "orthomosaic" | "elevation" | "point_cloud";

interface AddDataState {
  open: boolean;
  /** The importer to open directly; null shows the chooser. */
  tile: AddDataTile | null;
  show: (tile: AddDataTile | null) => void;
  close: () => void;
}

export const useAddData = create<AddDataState>((set) => ({
  open: false,
  tile: null,
  show: (tile) => set({ open: true, tile }),
  close: () => set({ open: false, tile: null }),
}));
