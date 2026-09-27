/* eslint-disable react-refresh/only-export-components --
   the provider and the hooks that read its context belong to one module. */
import { createContext, useContext, type ReactNode } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { WorkspaceState } from "./state/workspaceStore";
import type { ToolState } from "./tools/toolStore";
import type { SiteFrame } from "./types";

export interface WorkspaceStores {
  workspace: StoreApi<WorkspaceState>;
  tools: StoreApi<ToolState>;
  projectId: string;
  frame: SiteFrame;
}

const Ctx = createContext<WorkspaceStores | null>(null);

export function WorkspaceProvider({ value, children }: { value: WorkspaceStores; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspaceStores(): WorkspaceStores {
  const v = useContext(Ctx);
  if (!v) throw new Error("mapws hooks must be used inside <WorkspaceProvider>");
  return v;
}

/** A slice of the workspace store. Return primitives or stable references (zustand 5), or wrap with useShallow. */
export function useWorkspace<T>(selector: (s: WorkspaceState) => T): T {
  return useStore(useWorkspaceStores().workspace, selector);
}

export function useTools<T>(selector: (s: ToolState) => T): T {
  return useStore(useWorkspaceStores().tools, selector);
}
