import { create } from "zustand";
import type { AppEvent, Job, JobState } from "@contract/client";

export const ACTIVE_STATES: ReadonlySet<JobState> = new Set<JobState>(["queued", "running"]);

export function isActiveJob(job: Job): boolean {
  return ACTIVE_STATES.has(job.state);
}

export interface JobsState {
  jobs: Record<string, Job>;
  /** The global jobs slide-over (Shell). */
  panelOpen: boolean;
  upsert: (job: Job) => void;
  upsertMany: (jobs: Job[]) => void;
  setPanelOpen: (open: boolean) => void;
  /** `nowIso` stamps `finished_at` on terminal `job.state` events (injected by tests). */
  applyEvent: (ev: AppEvent, nowIso?: string) => void;
  active: () => Job[];
}

export const selectActiveCount = (s: JobsState): number => Object.values(s.jobs).filter(isActiveJob).length;

export const useJobsStore = create<JobsState>((set, get) => ({
  jobs: {},
  panelOpen: false,
  upsert: (job) => set((s) => ({ jobs: { ...s.jobs, [job.id]: job } })),
  upsertMany: (jobs) =>
    set((s) => {
      const next = { ...s.jobs };
      for (const job of jobs) next[job.id] = job;
      return { jobs: next };
    }),
  setPanelOpen: (open) => set({ panelOpen: open }),
  applyEvent: (ev, nowIso = new Date().toISOString()) =>
    set((s) => {
      const id = ev.job_id;
      if (!id || !s.jobs[id]) return s;
      const cur = s.jobs[id];
      if (ev.type === "job.progress") {
        return {
          jobs: {
            ...s.jobs,
            [id]: { ...cur, progress: ev.progress ?? cur.progress, message: ev.message ?? cur.message },
          },
        };
      }
      if (ev.type === "job.state") {
        const patch = (ev.payload ?? {}) as Partial<Job>;
        const state = patch.state ?? cur.state;
        const terminal = !ACTIVE_STATES.has(state);
        const next: Job = {
          ...cur,
          ...patch,
          state,
          progress: state === "succeeded" ? 1 : (ev.progress ?? cur.progress),
          finished_at: cur.finished_at ?? (terminal ? nowIso : null),
        };
        return { jobs: { ...s.jobs, [id]: next } };
      }
      return s;
    }),
  active: () => Object.values(get().jobs).filter(isActiveJob),
}));
