import { create } from "zustand";
import type { AppEvent } from "@contract/client";
import {
  consumeEcho,
  EMPTY_LEDGER,
  expectEchoes,
  releaseEchoes,
  renewEchoes,
  type EchoLedger,
} from "./changesEcho";

interface ChangesState {
  /** Bumped whenever the image list may have changed (import batches, box counts). */
  imagesRevision: number;
  /** Per image id: bumped whenever a job wrote proposals or reviews on it. */
  boxesRevision: Record<string, number>;
  /** Bumped on `surfaces.changed` (spec 2026-09-23-volumes section 11.3). */
  surfacesRevision: number;
  /** Bumped on `volumes.changed`. */
  volumesRevision: number;
  /** Bumped on `catalogue.changed` (F §13): a type or the severity scale changed. */
  catalogueRevision: number;
  /** Bumped on `data.changed` (spec 2026-09-26-foundation section 13): the tab counts and the Data list. */
  dataRevision: number;
  /** Bumped on `findings.changed` (except the echo of this client's own write) and after this
   * client's own finding writes (F §8.3). */
  findingsRevision: number;
  /** Own finding writes whose `findings.changed` echo is still expected (rulings R8). */
  findingEchoes: EchoLedger;
  expectFindingEchoes: (ids: readonly string[]) => void;
  releaseFindingEchoes: (ids: readonly string[]) => void;
  /** An own write succeeded: its expected echo gets a fresh TTL from now. */
  renewFindingEchoes: (ids: readonly string[]) => void;
  /** Bumped on `migration.changed`: the Projects list re-reads (F §11.3). */
  projectsRevision: number;
  /** Bumped on `map_workspace.changed`, `drawings.changed` and `maps.changed` (M-W1): the map workspace re-reads its frame, layers and surveys. */
  mapWorkspaceRevision: number;
  /** Bumped on `map_measurements.changed` (M-W1, read by M-W3). */
  mapMeasurementsRevision: number;
  /** The project the route has open (set by the Shell), or null. The events socket is app-wide, so
   * `findings.changed`, `data.changed`, `images.changed`, `boxes.changed`, `surfaces.changed`,
   * `volumes.changed`, `map_workspace.changed`, `drawings.changed`, `maps.changed` and
   * `map_measurements.changed` of another project (a job running in B while A is open) are ignored rather
   * than re-reading A's screens. App-wide events (`catalogue.changed`, `migration.changed`) are
   * never scoped this way. */
  openProjectId: string | null;
  setOpenProject: (projectId: string | null) => void;
  applyEvent: (ev: AppEvent) => void;
  bumpImages: () => void;
  bumpFindings: () => void;
  bumpData: () => void;
}

/** Events about one project, ignored while another project is open (see `openProjectId`). */
const PROJECT_SCOPED_EVENTS: ReadonlySet<string> = new Set([
  "findings.changed",
  "data.changed",
  "images.changed",
  "boxes.changed",
  "surfaces.changed",
  "volumes.changed",
  "map_workspace.changed",
  "drawings.changed",
  "maps.changed",
  "map_measurements.changed",
]);

export const useChangesStore = create<ChangesState>((set) => ({
  imagesRevision: 0,
  boxesRevision: {},
  surfacesRevision: 0,
  volumesRevision: 0,
  catalogueRevision: 0,
  dataRevision: 0,
  findingsRevision: 0,
  findingEchoes: EMPTY_LEDGER,
  expectFindingEchoes: (ids) =>
    set((s) => ({ findingEchoes: expectEchoes(s.findingEchoes, ids, Date.now()) })),
  releaseFindingEchoes: (ids) => set((s) => ({ findingEchoes: releaseEchoes(s.findingEchoes, ids) })),
  renewFindingEchoes: (ids) => set((s) => ({ findingEchoes: renewEchoes(s.findingEchoes, ids, Date.now()) })),
  projectsRevision: 0,
  mapWorkspaceRevision: 0,
  mapMeasurementsRevision: 0,
  openProjectId: null,
  setOpenProject: (openProjectId) => set({ openProjectId }),
  bumpImages: () => set((s) => ({ imagesRevision: s.imagesRevision + 1 })),
  bumpFindings: () => set((s) => ({ findingsRevision: s.findingsRevision + 1 })),
  bumpData: () => set((s) => ({ dataRevision: s.dataRevision + 1 })),
  applyEvent: (ev) =>
    set((s) => {
      const elsewhere = s.openProjectId !== null && ev.project_id !== s.openProjectId;
      if (PROJECT_SCOPED_EVENTS.has(ev.type) && elsewhere) return s;
      if (ev.type === "images.changed") return { imagesRevision: s.imagesRevision + 1 };
      if (ev.type === "boxes.changed") {
        const ids = (ev.payload as { image_ids?: unknown }).image_ids;
        if (!Array.isArray(ids)) return s;
        const boxesRevision = { ...s.boxesRevision };
        for (const id of ids) if (typeof id === "string") boxesRevision[id] = (boxesRevision[id] ?? 0) + 1;
        return { boxesRevision, imagesRevision: s.imagesRevision + 1 };
      }
      if (ev.type === "surfaces.changed") return { surfacesRevision: s.surfacesRevision + 1 };
      if (ev.type === "volumes.changed") return { volumesRevision: s.volumesRevision + 1 };
      if (ev.type === "data.changed") return { dataRevision: s.dataRevision + 1 };
      if (ev.type === "findings.changed") {
        // This client's own write already bumped once; its echo would re-read every view again.
        const echo = consumeEcho(s.findingEchoes, ev.payload, Date.now());
        if (echo.skip) return { findingEchoes: echo.ledger };
        return { findingsRevision: s.findingsRevision + 1, findingEchoes: echo.ledger };
      }
      if (ev.type === "migration.changed") return { projectsRevision: s.projectsRevision + 1 };
      if (ev.type === "catalogue.changed") return { catalogueRevision: s.catalogueRevision + 1 };
      if (ev.type === "map_workspace.changed") return { mapWorkspaceRevision: s.mapWorkspaceRevision + 1 };
      if (ev.type === "drawings.changed") return { mapWorkspaceRevision: s.mapWorkspaceRevision + 1 };
      if (ev.type === "maps.changed") return { mapWorkspaceRevision: s.mapWorkspaceRevision + 1 };
      if (ev.type === "map_measurements.changed")
        return { mapMeasurementsRevision: s.mapMeasurementsRevision + 1 };
      return s;
    }),
}));
