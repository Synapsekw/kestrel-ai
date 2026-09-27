import { create } from "zustand";
import type { AppEvent } from "@contract/client";

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
  /** Bumped on `findings.changed` and after this client's own finding writes (F §8.3). */
  findingsRevision: number;
  /** Bumped on `migration.changed`: the Projects list re-reads (F §11.3). */
  projectsRevision: number;
  /** The project the route has open (set by the Shell), or null. The events socket is app-wide, so
   * `findings.changed`, `data.changed`, `images.changed`, `boxes.changed`, `surfaces.changed` and
   * `volumes.changed` of another project (a job running in B while A is open) are ignored rather
   * than re-reading A's screens. App-wide events (`catalogue.changed`, `migration.changed`) are
   * never scoped this way. */
  openProjectId: string | null;
  setOpenProject: (projectId: string | null) => void;
  applyEvent: (ev: AppEvent) => void;
  bumpImages: () => void;
  bumpFindings: () => void;
  bumpData: () => void;
}

export const useChangesStore = create<ChangesState>((set) => ({
  imagesRevision: 0,
  boxesRevision: {},
  surfacesRevision: 0,
  volumesRevision: 0,
  catalogueRevision: 0,
  dataRevision: 0,
  findingsRevision: 0,
  projectsRevision: 0,
  openProjectId: null,
  setOpenProject: (openProjectId) => set({ openProjectId }),
  bumpImages: () => set((s) => ({ imagesRevision: s.imagesRevision + 1 })),
  bumpFindings: () => set((s) => ({ findingsRevision: s.findingsRevision + 1 })),
  bumpData: () => set((s) => ({ dataRevision: s.dataRevision + 1 })),
  applyEvent: (ev) =>
    set((s) => {
      const elsewhere = s.openProjectId !== null && ev.project_id !== s.openProjectId;
      const scoped = new Set([
        "findings.changed",
        "data.changed",
        "images.changed",
        "boxes.changed",
        "surfaces.changed",
        "volumes.changed",
      ]);
      if (scoped.has(ev.type) && elsewhere) return s;
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
      if (ev.type === "findings.changed") return { findingsRevision: s.findingsRevision + 1 };
      if (ev.type === "migration.changed") return { projectsRevision: s.projectsRevision + 1 };
      if (ev.type === "catalogue.changed") return { catalogueRevision: s.catalogueRevision + 1 };
      return s;
    }),
}));
