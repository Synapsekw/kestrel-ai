import { create } from "zustand";

export type NavSource = "data" | "review" | "selection" | "query" | null;

interface NavigationState {
  ids: string[];
  source: NavSource;
  setContext: (ids: string[], source: NavSource) => void;
  neighbours: (id: string) => { prev: string | null; next: string | null; index: number; count: number };
}

/** The ordered image ids the editor's Ctrl+Right / Ctrl+Left walk: set by whichever list opened the editor. */
export const useNavigationStore = create<NavigationState>((set, get) => ({
  ids: [],
  source: null,
  setContext: (ids, source) => set({ ids: [...ids], source }),
  neighbours: (id) => {
    const { ids } = get();
    const index = ids.indexOf(id);
    return {
      prev: index > 0 ? ids[index - 1] : null,
      next: index >= 0 && index < ids.length - 1 ? ids[index + 1] : null,
      index,
      count: ids.length,
    };
  },
}));
