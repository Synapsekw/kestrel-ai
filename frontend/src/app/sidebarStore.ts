import { create } from "zustand";
import { sidebarCollapsed } from "./routeModel";

export const SIDEBAR_STORAGE_KEY = "kestrel.sidebar";

/** The remembered choice; expanded when nothing usable is stored or storage is blocked. */
export function readSidebarPref(): boolean {
  try {
    const raw = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (raw === null) return false;
    const v: unknown = JSON.parse(raw);
    return typeof v === "object" && v !== null && (v as { collapsed?: unknown }).collapsed === true;
  } catch {
    return false;
  }
}

export function writeSidebarPref(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify({ collapsed }));
  } catch {
    // a blocked storage only loses the remembered choice
  }
}

export interface SidebarState {
  /** The operator's remembered preference (spec 2026-10-03-sidebar §4). */
  stored: boolean;
  /** This visit's choice on a forced (full-bleed or narrow) route; null when none. */
  override: boolean | null;
  toggle(forced: boolean): void;
  clearOverride(): void;
}

export const useSidebar = create<SidebarState>((set, get) => ({
  stored: readSidebarPref(),
  override: null,
  toggle: (forced) => {
    const s = get();
    if (forced) {
      set({ override: !sidebarCollapsed(s.stored, true, s.override) });
      return;
    }
    const next = !s.stored;
    set({ stored: next });
    writeSidebarPref(next);
  },
  clearOverride: () => {
    if (get().override !== null) set({ override: null });
  },
}));
