import type { SelectionState } from "@/data/selection";
import { GlassPanel, Segmented } from "@/ui";
import {
  BrowserFilters,
  BrowserGrid,
  BrowserSelectionBar,
  CaptureMap,
  FLAG_GPS,
  MiniMap,
  type BrowserFilterState,
  type FootprintInput,
  type ImageIndexState,
} from "./seams";

export type BrowserMode = "grid" | "map";

export interface BrowserPaneProps {
  projectId: string;
  imageId: string | null;
  index: ImageIndexState;
  filters: BrowserFilterState;
  onFilters: (f: BrowserFilterState) => void;
  mode: BrowserMode;
  onMode: (m: BrowserMode) => void;
  selection: SelectionState;
  onSelection: (s: SelectionState) => void;
  footprint: FootprintInput | null;
  onOpen: (id: string) => void;
  onDetect: (ids: string[]) => void;
}

const MODES = [
  { value: "grid" as const, label: "Grid" },
  { value: "map" as const, label: "Map" },
];

/** §6.1: header with Grid | Map, filters, then the grid with the mini-map, or the capture map. */
export function BrowserPane(p: BrowserPaneProps) {
  return (
    <GlassPanel
      as="section"
      variant="pane"
      aria-label="Image browser"
      className="flex h-full min-h-0 flex-col gap-2.5 p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Images</h2>
        <Segmented label="Browser view" size="sm" value={p.mode} onChange={p.onMode} options={MODES} />
      </div>
      <BrowserFilters projectId={p.projectId} value={p.filters} onChange={p.onFilters} index={p.index} />
      {/* Ruling 15: Grid ⇄ Map pops in, keyed by the mode. */}
      <div key={p.mode} className="flex min-h-0 flex-1 flex-col gap-2 animate-pop reduce-motion:animate-none">
        {p.mode === "grid" ? (
          <>
            <div className="flex min-h-0 flex-1 flex-col">
              <BrowserGrid
                projectId={p.projectId}
                index={p.index}
                currentId={p.imageId}
                sort={p.filters.sort}
                order={p.filters.order}
                selection={p.selection}
                onSelectionChange={p.onSelection}
                onOpen={p.onOpen}
              />
            </div>
            <MiniMap
              projectId={p.projectId}
              index={p.index}
              currentId={p.imageId}
              onOpen={p.onOpen}
              onExpand={() => p.onMode("map")}
            />
          </>
        ) : (
          // E's hooks (`data-point-count`, `data-footprint-kind`) sit on FW's wrapper: FB's CaptureMap
          // (`capture-map`) carries neither.
          <div
            data-testid="capture-map-host"
            data-point-count={p.index.flags.reduce((n, f) => n + (f & FLAG_GPS ? 1 : 0), 0)}
            data-footprint-kind={p.footprint?.kind ?? "none"}
            className="flex min-h-0 flex-1 flex-col"
          >
            <CaptureMap
              projectId={p.projectId}
              index={p.index}
              currentId={p.imageId}
              sort={p.filters.sort}
              footprint={p.footprint}
              onOpen={p.onOpen}
              onLasso={p.onDetect}
            />
          </div>
        )}
      </div>
      <BrowserSelectionBar
        projectId={p.projectId}
        selection={p.selection}
        onSelectionChange={p.onSelection}
        onDetect={p.onDetect}
      />
    </GlassPanel>
  );
}
