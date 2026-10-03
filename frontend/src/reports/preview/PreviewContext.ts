import { createContext, useContext } from "react";
import type { SnapshotRef } from "@/api/reports";
import type { PaperSize } from "../printTheme";

/** A brand's cover look (spec 2026-10-02-asset-findings §9): built by coverBrandOf from D2's overlay. */
export interface CoverBrand {
  /** Three hex stops for the band's 135° gradient. */
  gradient: readonly string[];
  /** The brand's text font family, or null for the theme font. */
  fontFamily: string | null;
  /** The brand's `on_dark` logo src, or null. */
  logoSrc: string | null;
}

export interface PreviewEnv {
  /** The `<img src>` for a snapshot, or null when there is no backend to ask. */
  resolveSnapshot: (ref: SnapshotRef) => string | null;
  /** The `<img src>` for a report asset (e.g. the cover logo), or null when there is no backend to ask (Ruling R-6). */
  resolveAsset: (assetId: string) => string | null;
  /** The preview's scroller: the IntersectionObserver root (Ruling 8). */
  scrollRoot: Element | null;
  /** The sheet size in effect (Ruling R-7). */
  paper: PaperSize;
  /** The brand the cover is drawn in; absent or null is the Kestrel theme. */
  brand?: CoverBrand | null;
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
