import type { ReactElement, ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ApiClient } from "@contract/client";
import { PROJECT_ID, fakeClient } from "@/test/fixtures";
import { TestApiProvider, renderWithProviders } from "@/test/render";
import { WorkspaceProvider, type WorkspaceStores } from "../context";
import { createWorkspaceStore } from "../state/workspaceStore";
import { createToolStore, type MapTool } from "../tools/toolStore";
import type { SiteFrame, Survey } from "../types";
import { UTM33, survey } from "./fixtures";

export function makeStores(
  opts: {
    frame?: SiteFrame;
    surveys?: Survey[];
    lookup?: (id: string) => MapTool | undefined;
  } = {},
): WorkspaceStores {
  const workspace = createWorkspaceStore();
  workspace.getState().setSurveys(opts.surveys ?? [survey("2026-08-14"), survey("2026-09-14")]);
  return {
    workspace,
    tools: createToolStore(opts.lookup),
    projectId: PROJECT_ID,
    frame: opts.frame ?? UTM33,
  };
}

export function renderInWorkspace(
  ui: ReactElement,
  opts: { stores?: WorkspaceStores; api?: ApiClient; route?: string } = {},
) {
  const stores = opts.stores ?? makeStores();
  const api = opts.api ?? fakeClient([]).api;
  const view = renderWithProviders(<WorkspaceProvider value={stores}>{ui}</WorkspaceProvider>, {
    api,
    route: opts.route ?? `/p/${PROJECT_ID}/maps`,
  });
  return { ...view, stores, api };
}

/** `renderHook` inside the same providers `renderInWorkspace` uses. */
export function renderHookInWorkspace<T>(
  hook: () => T,
  opts: { stores?: WorkspaceStores; api?: ApiClient; route?: string } = {},
) {
  const stores = opts.stores ?? makeStores();
  const api = opts.api ?? fakeClient([]).api;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TestApiProvider api={api}>
      <MemoryRouter initialEntries={[opts.route ?? `/p/${PROJECT_ID}/maps`]}>
        <WorkspaceProvider value={stores}>{children}</WorkspaceProvider>
      </MemoryRouter>
    </TestApiProvider>
  );
  const { result } = renderHook(hook, { wrapper });
  return { result, workspace: stores.workspace, tools: stores.tools, stores };
}
