/* eslint-disable react-refresh/only-export-components --
   a test-only Request shim next to the render helper that needs it; not a fast-refresh boundary. */
import type { ReactElement } from "react";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router-dom";
import { render } from "@testing-library/react";
import type { ApiClient } from "@contract/client";
import type { BackendMode } from "@/api/backend";
import { LocationProbe, TestApiProvider } from "./render";

// Same test-environment-only fix as routes/routes.test.tsx: the data router builds a `Request` for
// every navigation, and Node's `Request` rejects the `AbortSignal` jsdom's `AbortController` makes.
// No route here has a loader, so nothing reads the signal back; keep it out of the native check.
// Vitest isolates each test file, so this only applies to files that import this helper.
const NativeRequest = globalThis.Request;
class NavigationSafeRequest extends NativeRequest {
  constructor(input: RequestInfo | URL, init: RequestInit = {}) {
    const { signal, ...rest } = init;
    super(input, rest);
    if (signal) Object.defineProperty(this, "signal", { value: signal, configurable: true });
  }
}
globalThis.Request = NavigationSafeRequest as unknown as typeof Request;

/**
 * Like `renderWithProviders`, but inside a data router (`createMemoryRouter`), so hooks that need
 * one (`useBlocker`) work. `ui` mounts at `path` (default "/"); `/elsewhere` is a second route to
 * navigate to, and `LocationProbe` prints where the router is.
 */
export function renderWithDataRouter(
  ui: ReactElement,
  opts: { api?: ApiClient; route?: string; path?: string; mode?: BackendMode; routes?: RouteObject[] } = {},
) {
  const router = createMemoryRouter(
    [
      {
        path: opts.path ?? "/",
        element: (
          <>
            {ui}
            <LocationProbe />
          </>
        ),
      },
      { path: "/elsewhere", element: <p>Elsewhere</p> },
      ...(opts.routes ?? []),
    ],
    { initialEntries: [opts.route ?? "/"] },
  );
  const tree = <RouterProvider router={router} future={{ v7_startTransition: true }} />;
  return {
    router,
    ...render(
      opts.api ? (
        <TestApiProvider api={opts.api} mode={opts.mode}>
          {tree}
        </TestApiProvider>
      ) : (
        tree
      ),
    ),
  };
}
