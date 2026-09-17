import { create } from "zustand";
import type { AppEvent, Job } from "@contract/client";

const ACTIVE: ReadonlySet<Job["state"]> = new Set(["queued", "running"]);

interface JobsState {
  jobs: Record<string, Job>;
  upsert: (job: Job) => void;
  applyEvent: (ev: AppEvent) => void;
  active: () => Job[];
}

export const useJobsStore = create<JobsState>((set, get) => ({
  jobs: {},
  upsert: (job) => set((s) => ({ jobs: { ...s.jobs, [job.id]: job } })),
  applyEvent: (ev) =>
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
        return { jobs: { ...s.jobs, [id]: { ...cur, ...patch, progress: ev.progress ?? cur.progress } } };
      }
      return s;
    }),
  active: () => Object.values(get().jobs).filter((j) => ACTIVE.has(j.state)),
}));
