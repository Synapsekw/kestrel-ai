import { create } from "zustand";
import type { ProjectProgress } from "@/app/nextStep";

interface ProgressState {
  byProject: Record<string, ProjectProgress>;
  set: (projectId: string, progress: ProjectProgress) => void;
}

/** The last known counts per project, so the sidebar and the banners do not flash on every screen change. */
export const useProgressStore = create<ProgressState>((set) => ({
  byProject: {},
  set: (projectId, progress) => set((s) => ({ byProject: { ...s.byProject, [projectId]: progress } })),
}));
