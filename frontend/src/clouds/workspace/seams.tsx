import { createContext, useContext, type ComponentType } from "react";

export type ViewSubject = { kind: "finding"; id: string } | { kind: "cloud_measurement"; id: string };
export type CaptureReason = "create" | "move" | "save" | "refresh";

/**
 * What the batch-4 units hand each other through the workspace (controller ruling 1). C-R1 fills
 * `requestViewCapture` and `ReportViewCard`, C-L1 fills `LikelyViews`, at the one anchor in
 * `CloudWorkspace.tsx`. C-P1 and C-M1 only call `useWorkspaceSeams()`.
 */
export interface WorkspaceSeams {
  requestViewCapture: (subject: ViewSubject, reason: CaptureReason) => void;
  ReportViewCard: ComponentType<{ subject: ViewSubject }> | null;
  /** C-L1 shows Attach on each photo when `findingId` is passed (controller amendment to ruling 1). */
  LikelyViews: ComponentType<{
    point: [number, number, number];
    normal: [number, number, number] | null;
    findingId?: string;
    limit?: number;
  }> | null;
}

export const noViewCapture: WorkspaceSeams["requestViewCapture"] = () => {};

export const DEFAULT_SEAMS: WorkspaceSeams = {
  requestViewCapture: noViewCapture,
  ReportViewCard: null,
  LikelyViews: null,
};

export const WorkspaceSeamsContext = createContext<WorkspaceSeams>(DEFAULT_SEAMS);

export function useWorkspaceSeams(): WorkspaceSeams {
  return useContext(WorkspaceSeamsContext);
}
