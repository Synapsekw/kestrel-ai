import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Navigate, RouterProvider, createMemoryRouter, matchRoutes } from "react-router-dom";
import { appRoutes } from "./appRoutes";
import { legacyAppRedirects, legacyProjectRedirects } from "./legacyRedirects";
import { routeTree } from "./tree";

// React Router's data router builds a `Request` for every navigation, loader or not; under
// Vitest's jsdom environment Node's `Request` rejects any `AbortSignal` jsdom's `AbortController`
// produces, no matter what constructs it (the same test-environment-only defect `signalSafe`
// documents in test/fixtures.ts, reproducible with a bare `new Request(url, {signal})`). None of
// these routes has a loader, so nothing ever reads the signal back off the request; a thin
// subclass that keeps the signal out of the native constructor's validation is enough.
const NativeRequest = globalThis.Request;
class NavigationSafeRequest extends NativeRequest {
  constructor(input: RequestInfo | URL, init: RequestInit = {}) {
    const { signal, ...rest } = init;
    super(input, rest);
    if (signal) Object.defineProperty(this, "signal", { value: signal, configurable: true });
  }
}
globalThis.Request = NavigationSafeRequest as unknown as typeof Request;

const P = "7f1c2e3a-1111-4000-8000-000000000001";
const I = "10000000-5555-4000-8000-000000000001";

/** Every old path of spec section 5.3 and where it must land, query strings included. */
const CASES: [string, string][] = [
  ["/", "/projects"],
  [`/p/${P}`, `/p/${P}/overview`],
  ["/models", "/models/library"],
  [`/p/${P}/data`, `/p/${P}/images`],
  [`/p/${P}/edit/${I}`, `/p/${P}/images/${I}`],
  [`/p/${P}/edit/${I}?finding=f1`, `/p/${P}/images/${I}?finding=f1`],
  [`/p/${P}/label`, `/p/${P}/images?filter=unlabeled`],
  [`/p/${P}/past`, `/p/${P}/overview`],
  [`/p/${P}/past/maps/m1`, `/p/${P}/maps/m1`],
  [`/p/${P}/sources`, `/p/${P}/maps`],
  [`/p/${P}/surveys`, `/p/${P}/analytics`],
  [`/p/${P}/volumes`, `/p/${P}/measurements`],
  [`/p/${P}/volumes/v1`, `/p/${P}/measurements/v1`],
  [`/p/${P}/datasets`, `/models/datasets?project=${P}`],
  [`/p/${P}/datasets?dataset=d1`, `/models/datasets?dataset=d1&project=${P}`],
  [`/p/${P}/train`, "/models/training"],
  [`/p/${P}/train?job=j1`, "/models/training?job=j1"],
  ["/library", "/models/library"],
  ["/library?model=m1", "/models/library?model=m1"],
];

function land(start: string) {
  const models = appRoutes.find((r) => r.path === "models");
  const router = createMemoryRouter(
    [
      {
        path: "/",
        children: [
          { index: true, element: <Navigate to="/projects" replace /> },
          ...(models ? [models] : []),
          ...legacyAppRedirects,
          {
            path: "p/:projectId",
            children: [
              { index: true, element: <Navigate to="overview" replace /> },
              ...legacyProjectRedirects,
            ],
          },
          { path: "*", element: <p>landed</p> },
        ],
      },
    ],
    { initialEntries: [start] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const isRedirect = (route: unknown) =>
  [...legacyProjectRedirects, ...legacyAppRedirects].includes(
    route as (typeof legacyProjectRedirects)[number],
  );

describe("routes", () => {
  it.each(CASES)("%s lands on %s", async (from, to) => {
    const router = land(from);
    await screen.findByText("landed");
    const { pathname, search } = router.state.location;
    expect(`${pathname}${search}`).toBe(to);
  });

  it.each(CASES.map(([, to]) => to.split("?")[0]))("%s is a real screen in the tree", (path) => {
    const matches = matchRoutes(routeTree, path);
    expect(matches).not.toBeNull();
    const last = matches!.at(-1)!.route;
    expect(last.path).not.toBe("*");
    expect(isRedirect(last)).toBe(false);
  });

  it.each([
    `/p/${P}/overview`,
    `/p/${P}/images/${I}`,
    `/p/${P}/maps/m1`,
    `/p/${P}/clouds/c1`,
    `/p/${P}/findings/f1`,
    `/p/${P}/measurements/v1`,
    `/p/${P}/reports`,
    `/p/${P}/settings`,
    `/p/${P}/runs`,
    `/p/${P}/review`,
    `/p/${P}/analytics`,
    `/p/${P}/site-areas`,
    `/p/${P}/query`,
    `/p/${P}/export`,
    "/models/datasets/d1",
    "/models/training/r1",
    "/catalogue",
    "/catalogue/severity",
    "/jobs",
    "/settings",
    "/about",
  ])("routes %s", (path) => {
    const last = matchRoutes(routeTree, path)!.at(-1)!.route;
    expect(last.path).not.toBe("*");
  });

  it.each(["/nowhere", `/p/${P}/nonsense`, "/models/nothing"])(
    "sends %s to the in-shell not-found page",
    (path) => {
      expect(matchRoutes(routeTree, path)!.at(-1)!.route.path).toBe("*");
    },
  );
});
