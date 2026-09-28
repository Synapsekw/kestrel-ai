import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Outlet, RouterProvider, createMemoryRouter, matchRoutes, type RouteObject } from "react-router-dom";
import { PROJECT_TABS, SECONDARY_PAGES } from "@/app/routeModel";
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
  ["/?from=toast", "/projects?from=toast"],
  [`/p/${P}`, `/p/${P}/overview`],
  [`/p/${P}?finding=f1#note`, `/p/${P}/overview?finding=f1#note`],
  ["/models", "/models/library"],
  ["/models?model=m1", "/models/library?model=m1"],
  [`/p/${P}/data`, `/p/${P}/images`],
  [`/p/${P}/edit/${I}`, `/p/${P}/images/${I}`],
  [`/p/${P}/edit/${I}?finding=f1`, `/p/${P}/images/${I}?finding=f1`],
  [`/p/${P}/label`, `/p/${P}/images?filter=unlabeled`],
  [`/p/${P}/query`, `/p/${P}/images?batch=1`],
  [`/p/${P}/query?source=s1`, `/p/${P}/images?source=s1&batch=1`],
  [`/p/${P}/past`, `/p/${P}/overview`],
  [`/p/${P}/past/maps/m1`, `/p/${P}/maps?map=m1`],
  // The retired pixel viewer's address opens the workspace on that map (spec M §5, §11).
  [`/p/${P}/maps/m1`, `/p/${P}/maps?map=m1`],
  [`/p/${P}/maps/m1?at=243550.000,3178050.000`, `/p/${P}/maps?at=243550.000%2C3178050.000&map=m1`],
  // An old "Review on the map" link: review becomes a selection, never a compare `mode`.
  [`/p/${P}/maps/m1?mode=review&run=r1`, `/p/${P}/maps?map=m1&sel=run%3Ar1`],
  // An old "Draw an area" link: the workspace's zone tool.
  [`/p/${P}/maps/m1?draw=site-area`, `/p/${P}/maps?map=m1&tool=zone`],
  [`/p/${P}/sources`, `/p/${P}/maps`],
  [`/p/${P}/surveys`, `/p/${P}/analytics`],
  [`/p/${P}/volumes`, `/p/${P}/measurements/volumes`],
  [`/p/${P}/volumes/v1`, `/p/${P}/measurements/volumes/v1`],
  [`/p/${P}/measurements/v1`, `/p/${P}/measurements/volumes/v1`],
  [`/p/${P}/datasets`, `/models/datasets?project=${P}`],
  [`/p/${P}/datasets?dataset=d1`, `/models/datasets?dataset=d1&project=${P}`],
  [`/p/${P}/train`, "/models/training"],
  [`/p/${P}/train?job=j1`, "/models/training?job=j1"],
  ["/library", "/models/library"],
  ["/library?model=m1", "/models/library?model=m1"],
];

// The index redirects come from the real tree, so a change to tree.tsx shows up here.
const shellChildren = routeTree[0].children!;
const rootIndex = shellChildren.find((r) => r.index)!;
const projectIndex = shellChildren.find((r) => r.path === "p/:projectId")!.children!.find((r) => r.index)!;

function land(start: string) {
  // The real "models" entry is a ModelsLayout with real sub-screens (library, datasets,
  // training); this router only cares where a redirect lands, so its non-index children are
  // swapped for a "landed" leaf (the index child stays real: it's the redirect under test).
  const modelsRoute = appRoutes.find((r) => r.path === "models");
  const models: RouteObject | undefined =
    modelsRoute &&
    ({
      ...modelsRoute,
      element: <Outlet />,
      children: modelsRoute.children?.map((child): RouteObject =>
        child.index ? child : { ...child, element: <p>landed</p> },
      ),
    } as RouteObject);
  const router = createMemoryRouter(
    [
      {
        path: "/",
        children: [
          rootIndex as RouteObject,
          ...(models ? [models] : []),
          ...legacyAppRedirects,
          {
            path: "p/:projectId",
            children: [
              projectIndex as RouteObject,
              // The real tree's static screen route, which outranks `measurements/:measurementId`.
              { path: "measurements/volumes", element: <p>landed</p> },
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
    const { pathname, search, hash } = router.state.location;
    expect(`${pathname}${search}${hash}`).toBe(to);
  });

  it.each(CASES.map(([, to]) => to.split(/[?#]/)[0]))("%s is a real screen in the tree", (path) => {
    const matches = matchRoutes(routeTree, path);
    expect(matches).not.toBeNull();
    const last = matches!.at(-1)!.route;
    expect(last.path).not.toBe("*");
    expect(isRedirect(last)).toBe(false);
  });

  it.each([
    ...[...PROJECT_TABS, ...SECONDARY_PAGES].map((e) => `/p/${P}/${e.id}`),
    `/p/${P}/images/${I}`,
    `/p/${P}/maps/m1`,
    `/p/${P}/maps/m1/evaluate`,
    `/p/${P}/clouds/c1`,
    `/p/${P}/findings/f1`,
    `/p/${P}/measurements/v1`,
    `/p/${P}/measurements/volumes`,
    `/p/${P}/measurements/volumes/v1`,
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

  it("serves the tab and every image from one route entry, so the workspace never remounts", () => {
    const tab = matchRoutes(routeTree, `/p/${P}/images`)!.at(-1)!.route;
    const image = matchRoutes(routeTree, `/p/${P}/images/${I}`)!.at(-1)!.route;
    expect(tab).toBe(image);
    expect(tab.path).toBe("images/:imageId?");
  });
});
