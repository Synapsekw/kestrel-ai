import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { useAddData } from "./addDataStore";
import {
  defaultRouteActions,
  useProvideRouteActions,
  useProvidedRouteActions,
  useRouteActions,
  type RouteAction,
} from "./routeActions";
import { routeInfo } from "./routeModel";

const at =
  (path: string) =>
  ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>;

describe("route actions", () => {
  beforeEach(() => {
    useProvidedRouteActions.setState({ entries: [] });
    useAddData.setState({ open: false, tile: null });
  });

  it("gives every project route Add data and Generate report, the report opening the Reports tab", () => {
    const open = vi.fn();
    const actions = defaultRouteActions(routeInfo("/p/p1/images"), open);
    expect(actions.map((a) => a.label)).toEqual(["Add data", "Generate report"]);
    expect(actions[1]).toMatchObject({ variant: "primary", to: "/p/p1/reports" });
    actions[0].run?.();
    expect(open).toHaveBeenCalled();
  });

  it("shows New finding on the Findings tab, disabled with the reason", () => {
    const [first] = defaultRouteActions(routeInfo("/p/p1/findings"), vi.fn());
    expect(first).toMatchObject({ label: "New finding", disabled: true });
    expect(first.tooltip).toMatch(/created in the Images, Maps and Point clouds workspaces/);
  });

  it("gives app sections no default actions", () => {
    expect(defaultRouteActions(routeInfo("/catalogue"), vi.fn())).toEqual([]);
    expect(defaultRouteActions(routeInfo("/projects"), vi.fn())).toEqual([]);
  });

  it("puts a screen's own actions before the defaults and opens Add data from the default", () => {
    const provided: RouteAction[] = [{ id: "new-type", label: "New type", run: vi.fn() }];
    const { result } = renderHook(
      () => {
        useProvideRouteActions(provided);
        return useRouteActions();
      },
      { wrapper: at("/p/p1/overview") },
    );
    expect(result.current.map((a) => a.label)).toEqual(["New type", "Add data", "Generate report"]);
    result.current[1].run?.();
    expect(useAddData.getState()).toMatchObject({ open: true, tile: null });
  });
});
