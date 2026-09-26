import { create } from "zustand";

/** Commands a host sends the open inspector (review key T, F §5.6). */
interface InspectorCommands {
  typePickerNonce: number;
  openTypePicker: () => void;
}

export const useInspectorCommands = create<InspectorCommands>((set) => ({
  typePickerNonce: 0,
  openTypePicker: () => set((s) => ({ typePickerNonce: s.typePickerNonce + 1 })),
}));
