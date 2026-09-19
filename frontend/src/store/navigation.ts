import { create } from "zustand";

export type NavSource = "data" | "review" | "selection" | "query" | null;

interface NavigationState {
  ids: string[];
  source: NavSource;
  /** Path and query of the list that opened the editor, for the editor's back link. */
  returnTo: string | null;
  setContext: (ids: string[], source: NavSource, returnTo?: string | null) => void;
  neighbours: (id: string) => { prev: string | null; next: string | null; index: number; count: number };
}

/** The ordered image ids the editor's Ctrl+Right / Ctrl+Left walk: set by whichever list opened the editor. */
export const useNavigationStore = create<NavigationState>((set, get) => ({
  ids: [],
  source: null,
  returnTo: null,
  setContext: (ids, source, returnTo = null) => set({ ids: [...ids], source, returnTo }),
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
