import { create } from "zustand";
import type { AppEvent } from "@contract/client";

interface ProjectAgentEvents {
  /** Per project id: bumped on every `agent.changed` event; the drawer refetches when it moves. */
  revision: Record<string, number>;
  bump: (projectId: string) => void;
  applyEvent: (ev: AppEvent) => void;
}

export const useProjectAgentEvents = create<ProjectAgentEvents>((set, get) => ({
  revision: {},
  bump: (projectId) =>
    set((s) => ({ revision: { ...s.revision, [projectId]: (s.revision[projectId] ?? 0) + 1 } })),
  applyEvent: (ev) => {
    if (ev.type === "agent.changed" && ev.project_id) get().bump(ev.project_id);
  },
}));
