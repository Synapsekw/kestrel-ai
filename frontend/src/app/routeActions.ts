import { useEffect, useId, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { create } from "zustand";
import { ADD_DATA_LOADING } from "@/data/addDataTiles";
import type { IconName } from "@/ui";
import { useAddData } from "./addDataStore";
import { routeInfo, type RouteInfo } from "./routeModel";

/** A button in the top bar's context area (spec section 5.1); the palette lists the enabled ones too. */
export interface RouteAction {
  id: string;
  label: string;
  icon?: IconName;
  variant?: "primary" | "secondary";
  /** Renders a link instead of a button. */
  to?: string;
  run?: () => void;
  disabled?: boolean;
  /** Why it is disabled, or what it does. */
  tooltip?: string;
}

/** `openAddData` is null while the shell's project is not loaded: Add data then shows, disabled. */
export function defaultRouteActions(info: RouteInfo, openAddData: (() => void) | null): RouteAction[] {
  if (!info.projectId) return [];
  const actions: RouteAction[] = [];
  if (info.tab === "findings") {
    actions.push({
      id: "new-finding",
      label: "New finding",
      icon: "plus",
      disabled: true,
      tooltip: "Findings are created in the Images, Maps and Point clouds workspaces",
    });
  }
  actions.push(
    openAddData
      ? { id: "add-data", label: "Add data", icon: "plus", variant: "secondary", run: openAddData }
      : {
          id: "add-data",
          label: "Add data",
          icon: "plus",
          variant: "secondary",
          disabled: true,
          tooltip: ADD_DATA_LOADING,
        },
  );
  actions.push({
    id: "generate-report",
    label: "Generate report",
    icon: "report",
    variant: "primary",
    to: `/p/${info.projectId}/reports`,
  });
  return actions;
}

interface Provided {
  entries: { key: string; actions: readonly RouteAction[] }[];
  put: (key: string, actions: readonly RouteAction[]) => void;
  remove: (key: string) => void;
}

export const useProvidedRouteActions = create<Provided>((set) => ({
  entries: [],
  put: (key, actions) =>
    set((s) => ({ entries: [...s.entries.filter((e) => e.key !== key), { key, actions }] })),
  remove: (key) => set((s) => ({ entries: s.entries.filter((e) => e.key !== key) })),
}));

/** A screen's own context actions (Catalogue "New type", Models "New dataset"…) while it is mounted. Pass a memoised array. */
export function useProvideRouteActions(actions: readonly RouteAction[]): void {
  const key = useId();
  useEffect(() => {
    useProvidedRouteActions.getState().put(key, actions);
  }, [key, actions]);
  useEffect(() => () => useProvidedRouteActions.getState().remove(key), [key]);
}

/** The current route's actions: the screen's own first, then the route's defaults. */
export function useRouteActions(): RouteAction[] {
  const { pathname } = useLocation();
  const entries = useProvidedRouteActions((s) => s.entries);
  const loadedId = useAddData((s) => s.projectId);
  return useMemo(() => {
    const info = routeInfo(pathname);
    const ready = !!info.projectId && info.projectId === loadedId;
    return [
      ...entries.flatMap((e) => e.actions),
      ...defaultRouteActions(info, ready ? () => useAddData.getState().show(null) : null),
    ];
  }, [entries, pathname, loadedId]);
}
