import { create } from "zustand";
import type { AlignSession } from "./alignModel";

interface AlignState {
  session: AlignSession | null;
  notice: string | null;
  begin: (session: AlignSession, notice?: string | null) => void;
  end: () => void;
}

/** The K tool's one session (spec §8.3). First cut: Task 8 completes it. */
export const useAlignStore = create<AlignState>((set) => ({
  session: null,
  notice: null,
  begin: (session, notice = null) => set({ session, notice }),
  end: () => set({ session: null, notice: null }),
}));
