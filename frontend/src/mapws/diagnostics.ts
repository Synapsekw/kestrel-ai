import { useEffect } from "react";
import { DIAGNOSTICS_KEY } from "@/clouds/viewer/diagnostics";
import { useWorkspace, useWorkspaceStores } from "./context";

/** M-X's e2e drives the map at site coordinates through this (as `__kestrelCloudViewer` for clouds). */
export interface SiteMapDiagnostics {
  /** CSS pixels relative to the `site-map` pane. */
  pixelOf(e: number, n: number): [number, number] | null;
  coordOf(x: number, y: number): [number, number] | null;
  /** Metres per CSS pixel. */
  resolution(): number | null;
}

declare global {
  interface Window {
    __kestrelSiteMap?: SiteMapDiagnostics;
  }
}

/** Diagnostics are on when `localStorage["kestrel.diagnostics"] === "1"` (the clouds viewer's key). */
export function diagnosticsOn(): boolean {
  try {
    return localStorage.getItem(DIAGNOSTICS_KEY) === "1";
  } catch {
    return false;
  }
}

/** Installs `window.__kestrelSiteMap` while mounted with a view and diagnostics on; never otherwise. */
export function useSiteMapProbe(): void {
  const { workspace } = useWorkspaceStores();
  const viewApi = useWorkspace((s) => s.viewApi);
  useEffect(() => {
    if (!viewApi || !diagnosticsOn()) return;
    const probe: SiteMapDiagnostics = {
      pixelOf: (e, n) => viewApi.pixelOf([e, n]),
      coordOf: (x, y) => viewApi.coordOf([x, y]),
      resolution: () => workspace.getState().viewInfo?.resolution ?? null,
    };
    window.__kestrelSiteMap = probe;
    return () => {
      if (window.__kestrelSiteMap === probe) delete window.__kestrelSiteMap;
    };
  }, [viewApi, workspace]);
}
