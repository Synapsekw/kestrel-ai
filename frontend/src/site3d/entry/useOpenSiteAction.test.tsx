import { act, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useProvidedRouteActions } from "@/app/routeActions";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { fakeClient } from "@/test/fixtures";
import type { SiteAt } from "./links";
import { useOpenSiteAction } from "./useOpenSiteAction";

function Probe({ where }: { where: () => SiteAt | null }) {
  useOpenSiteAction("p1", where);
  return null;
}
const action = () =>
  useProvidedRouteActions
    .getState()
    .entries.flatMap((e) => e.actions)
    .find((a) => a.id === "open-site-3d");

describe("useOpenSiteAction", () => {
  it("offers Open site in 3D in the top bar and opens the site view at the current spot", () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <>
        <Probe where={() => ({ x: 244400.5, y: 3179600.25, epsg: 32639 })} />
        <LocationProbe />
      </>,
      { api, route: "/p/p1/maps" },
    );
    expect(action()?.label).toBe("Open site in 3D");
    act(() => action()!.run!());
    expect(screen.getByTestId("location")).toHaveTextContent("/p/p1/site?at=244400.50,3179600.25&epsg=32639");
  });

  it("without a spot it opens the site view framed", () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <>
        <Probe where={() => null} />
        <LocationProbe />
      </>,
      { api, route: "/p/p1/clouds/c1" },
    );
    act(() => action()!.run!());
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/p\/p1\/site$/);
  });
});
