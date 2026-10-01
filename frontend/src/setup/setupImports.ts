import { create } from "zustand";
import type { ApiClient, Job } from "@contract/client";
import { createPointCloud } from "@/api/clouds";
import { importElevation } from "@/api/elevations";
import { messageOf } from "@/api/errors";
import { createMap } from "@/api/maps";
import { createSource } from "@/api/sources";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { useJobsStore } from "@/store/jobs";
import { startDrawing } from "./drawingSetup";
import type {
  ImportPlan,
  ImportRoute,
  ImportUnit,
  OmittedFiles,
  StartOutcome,
  UnitState,
} from "./importPlan";

/** One slot's imports as the Overview notice shows them (index `SlotImport`, plus `label` and `failed`). */
export interface SlotImport {
  slotKey: string;
  label: string;
  /** The slot's worst import: failed, then needs_choice, then pending, then started. */
  state: UnitState;
  /** The worst import's message: why it failed, or what the operator must choose. */
  error?: string;
  /** How many of this slot's imports failed; Retry re-runs exactly these. */
  failed: number;
}

export interface ProjectImports {
  labels: Record<string, string>;
  units: ImportUnit[];
  omitted: OmittedFiles[];
}

interface SetupImportsState {
  byProject: Record<string, ProjectImports>;
  /** Records every unit as pending at once, then starts them; never rejects (failures stay on the unit). */
  start: (api: ApiClient, projectId: string, plan: ImportPlan) => Promise<void>;
  /** Re-runs the slot's failed units only. */
  retry: (api: ApiClient, projectId: string, slotKey: string) => Promise<void>;
  dismiss: (projectId: string) => void;
}

const MAX_NAME = 200; // ElevationImportRequest.name maxLength

function stem(path: string): string {
  const base = (path.split(/[\\/]/).pop() ?? "").replace(/\.[^.]+$/, "");
  return base.slice(0, MAX_NAME) || "Elevation";
}

function started(job: Job): StartOutcome {
  useJobsStore.getState().upsert(job);
  return { state: "started", jobId: job.id };
}

type Starter = (api: ApiClient, projectId: string, path: string) => Promise<StartOutcome>;

/** The existing importer behind each route (spec §3), with the Add data dialogs' defaults. */
const STARTERS: Record<ImportRoute, Starter> = {
  images: async (api, pid, folder) => started((await createSource(api, pid, { folder })).job),
  map: async (api, pid, path) => started((await createMap(api, pid, { path })).job),
  // Plan ruling U6-2: the dialog's default role; the surface's role can be changed afterwards.
  elevation: async (api, pid, path) =>
    started((await importElevation(api, pid, { path, name: stem(path), role: "dsm" })).job),
  pointcloud: async (api, pid, path) => started((await createPointCloud(api, pid, { path })).job),
  drawing: startDrawing,
};

/** Drawings in flight at once: each polls its inspection every second for up to ten minutes. */
export const DRAWING_CONCURRENCY = 4;

const RANK: Record<UnitState, number> = { started: 0, pending: 1, needs_choice: 2, failed: 3 };

/**
 * The setup imports of each new project (spec §7.4). Module state, not component state, so the
 * imports keep starting while the operator moves between screens (ADR
 * 2026-09-30-setup-dispatch-lives-in-a-store-not-the-page). Not persisted: an app restart forgets
 * the notice, and the jobs themselves stay in Jobs.
 */
export const useSetupImports = create<SetupImportsState>((set, get) => {
  const patch = (projectId: string, unitId: string, next: Partial<ImportUnit>) =>
    set((s) => {
      const p = s.byProject[projectId];
      if (!p) return s; // dismissed while the request was in flight
      const units = p.units.map((u) => (u.id === unitId ? { ...u, ...next } : u));
      return { byProject: { ...s.byProject, [projectId]: { ...p, units } } };
    });

  const run = async (api: ApiClient, projectId: string, unit: ImportUnit) => {
    try {
      const out = await STARTERS[unit.route](api, projectId, unit.path);
      patch(
        projectId,
        unit.id,
        out.state === "started"
          ? { state: "started", jobId: out.jobId, error: undefined }
          : { state: "needs_choice", error: out.error },
      );
    } catch (e) {
      const error = messageOf(e, "could not start the import");
      pushLog(`setup import failed: ${unit.route} ${unit.path}: ${error}`);
      patch(projectId, unit.id, { state: "failed", error });
    }
  };

  // Plan ruling U6-3: one request at a time; drawings last, a few at a time (each waits on its inspect).
  const runAll = async (api: ApiClient, projectId: string, units: ImportUnit[]) => {
    for (const u of units.filter((x) => x.route !== "drawing")) await run(api, projectId, u);
    useChangesStore.getState().bumpData();
    const drawings = units.filter((x) => x.route === "drawing");
    let next = 0;
    const worker = async () => {
      while (next < drawings.length) await run(api, projectId, drawings[next++]);
    };
    await Promise.all(Array.from({ length: Math.min(DRAWING_CONCURRENCY, drawings.length) }, worker));
  };

  return {
    byProject: {},
    start: async (api, projectId, plan) => {
      // A blocked unit (ruling U6-6) is recorded as failed with its reason and not sent; Retry sends it.
      const units: ImportUnit[] = plan.units.map((u) =>
        u.blocked
          ? { ...u, state: "failed", error: u.blocked }
          : { ...u, state: "pending", error: undefined },
      );
      set((s) => ({
        byProject: { ...s.byProject, [projectId]: { labels: plan.labels, units, omitted: plan.omitted } },
      }));
      await runAll(
        api,
        projectId,
        units.filter((u) => u.state === "pending"),
      );
    },
    retry: async (api, projectId, slotKey) => {
      const failed = (get().byProject[projectId]?.units ?? []).filter(
        (u) => u.state === "failed" && u.slotKeys.includes(slotKey),
      );
      if (failed.length === 0) return;
      for (const u of failed) patch(projectId, u.id, { state: "pending", error: undefined });
      await runAll(api, projectId, failed);
    },
    dismiss: (projectId) =>
      set((s) => {
        const byProject = { ...s.byProject };
        delete byProject[projectId];
        return { byProject };
      }),
  };
});

/** The per-slot view of a project's setup imports, in the template's slot order. */
export function slotImports(p: ProjectImports | undefined): SlotImport[] {
  if (!p) return [];
  return Object.entries(p.labels).map(([slotKey, label]) => {
    const mine = p.units.filter((u) => u.slotKeys.includes(slotKey));
    const worst = mine.reduce<ImportUnit | undefined>(
      (w, u) => (!w || RANK[u.state] > RANK[w.state] ? u : w),
      undefined,
    );
    return {
      slotKey,
      label,
      state: worst?.state ?? "started",
      error: worst?.error,
      failed: mine.filter((u) => u.state === "failed").length,
    };
  });
}
