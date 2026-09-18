/* eslint-disable react-refresh/only-export-components --
   a test-only provider next to the render helper that mounts it; not a fast-refresh boundary. */
import { useMemo, type ReactElement, type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render } from "@testing-library/react";
import type { ApiClient } from "@contract/client";
import { ApiContext, type ApiContextValue } from "@/api/client";

export function TestApiProvider({ api, children }: { api: ApiClient; children: ReactNode }) {
  const value = useMemo<ApiContextValue>(
    () => ({
      client: api,
      info: { baseUrl: "http://fake", token: "t", mode: "mock" },
      health: { status: "ok", version: "test", pid: 1, started_at: "2026-09-17T00:00:00Z" },
    }),
    [api],
  );
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

/** Renders `ui` inside the API context and a memory router; `path` mounts it as a route so `useParams` works. */
export function renderWithProviders(
  ui: ReactElement,
  opts: { api: ApiClient; route?: string; path?: string },
) {
  return render(
    <TestApiProvider api={opts.api}>
      <MemoryRouter initialEntries={[opts.route ?? "/"]}>
        {opts.path ? (
          <Routes>
            <Route path={opts.path} element={ui} />
          </Routes>
        ) : (
          ui
        )}
      </MemoryRouter>
    </TestApiProvider>,
  );
}
