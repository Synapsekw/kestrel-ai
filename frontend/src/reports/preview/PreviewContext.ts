import { createContext, useContext } from "react";
import type { SnapshotRef } from "@/api/reports";
import type { PaperSize } from "../printTheme";

export interface PreviewEnv {
  /** The `<img src>` for a snapshot, or null when there is no backend to ask. */
  resolveSnapshot: (ref: SnapshotRef) => string | null;
  /** The `<img src>` for a report asset (e.g. the cover logo), or null when there is no backend to ask (Ruling R-6). */
  resolveAsset: (assetId: string) => string | null;
  /** The preview's scroller: the IntersectionObserver root (Ruling 8). */
  scrollRoot: Element | null;
  /** The sheet size in effect (Ruling R-7). */
  paper: PaperSize;
}

export const PreviewEnvContext = createContext<PreviewEnv>({
  resolveSnapshot: () => null,
  resolveAsset: () => null,
  scrollRoot: null,
  paper: "A4",
});

export function usePreviewEnv(): PreviewEnv {
  return useContext(PreviewEnvContext);
}
