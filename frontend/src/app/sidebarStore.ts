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
  /** This visit's choice on a forced route, tied to the route's transitionKey it was made on; null when none. */
  override: { key: string; collapsed: boolean } | null;
  toggle(forced: boolean, key: string): void;
  clearOverride(): void;
}

export const useSidebar = create<SidebarState>((set, get) => ({
  stored: readSidebarPref(),
  override: null,
  toggle: (forced, key) => {
    const s = get();
    if (forced) {
      const here = s.override?.key === key ? s.override.collapsed : null;
      set({ override: { key, collapsed: !sidebarCollapsed(s.stored, true, here) } });
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
