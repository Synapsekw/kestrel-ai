import { create } from "zustand";
import type { CloudViewOut } from "@contract/client";
import type { CaptureReason, ViewSubject } from "../workspace/seams";

/** `"missing"`: the Capture-missing-views pose rule (stored pose re-targeted, else auto framing). */
export type QueueReason = CaptureReason | "missing";

export interface BulkProgress {
  done: number;
  /** 0 while the subjects are still being listed. */
  total: number;
}

export interface ViewActions {
  enqueue(subject: ViewSubject, reason: QueueReason): void;
  captureMissing(): void;
  cancelMissing(): void;
}

interface ViewState {
  projectId: string | null;
  cloudId: string | null;
  /** Keyed by `subjectKey`; null until the first `listCloudViews` answered. */
  views: Record<string, CloudViewOut> | null;
  /** Subjects with a capture waiting or running. */
  busy: Record<string, true>;
  bulk: BulkProgress | null;
  /** A viewer handle exists, so captures can run. */
  ready: boolean;
  actions: ViewActions | null;
  reset(projectId: string | null, cloudId: string | null): void;
  setViews(items: CloudViewOut[]): void;
  putView(view: CloudViewOut): void;
  setBusy(key: string, on: boolean): void;
  setBulk(bulk: BulkProgress | null): void;
  setReady(on: boolean): void;
  setActions(actions: ViewActions | null): void;
}

export function subjectKey(s: ViewSubject): string {
  return `${s.kind}:${s.id}`;
}

const keyOf = (v: CloudViewOut) => `${v.subject_kind}:${v.subject_id}`;

/** One workspace is mounted at a time; `useViewCapture` resets this on mount and unmount. */
export const useViewStore = create<ViewState>((set) => ({
  projectId: null,
  cloudId: null,
  views: null,
  busy: {},
  bulk: null,
  ready: false,
  actions: null,
  reset: (projectId, cloudId) =>
    set({ projectId, cloudId, views: null, busy: {}, bulk: null, ready: false, actions: null }),
  setViews: (items) => set({ views: Object.fromEntries(items.map((v) => [keyOf(v), v])) }),
  putView: (view) => set((s) => ({ views: { ...(s.views ?? {}), [keyOf(view)]: view } })),
  setBusy: (key, on) =>
    set((s) => {
      if (on === Boolean(s.busy[key])) return s;
      const busy = { ...s.busy };
      if (on) busy[key] = true;
      else delete busy[key];
      return { busy };
    }),
  setBulk: (bulk) => set({ bulk }),
  setReady: (on) => set((s) => (s.ready === on ? s : { ready: on })),
  setActions: (actions) => set({ actions }),
}));
