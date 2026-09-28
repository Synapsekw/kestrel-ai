import { create } from "zustand";

/** R-W5-15: what a row-menu item asked for; the component that hosts the drawing dialogs performs it. */
export interface DrawingIntent {
  kind: "align" | "layers" | "knockout" | "reimport" | "delete";
  id: string;
}

export const useDrawingUi = create<{
  intent: DrawingIntent | null;
  request: (i: DrawingIntent) => void;
  clear: () => void;
}>((set) => ({
  intent: null,
  request: (intent) => set({ intent }),
  clear: () => set({ intent: null }),
}));
