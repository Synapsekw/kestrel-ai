import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAP_ID, PROJECT_ID, exampleGeoMap, fakeClient, type FakeRoute } from "@/test/fixtures";
import { FINDING_ID, FINDING_ID_2, exampleFinding, exampleFinding2 } from "@/test/findingFixtures";
import { LocationProbe, TestApiProvider } from "@/test/render";
import { useToastStore } from "@/ui";
import { MapWorkspace } from "./MapWorkspace";
import { UTM33, layer } from "./test/fixtures";
import { WS, fakeView, workspaceRoutes } from "./test/workspaceScreen";

vi.mock("./view/SiteMap", async () => ({
  SiteMap: (await import("./test/workspaceScreen")).FakeSiteMap,
}));

vi.mock("@/findings/FindingInspector", () => ({
  FindingInspector: (p: { findingId: string }) => <aside aria-label="Finding">finding {p.findingId}</aside>,
}));

const onMap = {
  ...exampleFinding2,
  lon: 15.01,
  lat: 44.99,
  attachment_count: 0,
  comment_count: 0,
};
/** One georeferenced map, so the site has an extent to fit. */
const LAYERS = { frame: UTM33, items: [layer("map", MAP_ID, { date: "2026-04-15" })] };
const base = (
  finding: FakeRoute["body"],
  findingStatus = 200,
  over: { ws?: FakeRoute["body"]; map?: FakeRoute["body"] } = {},
): FakeRoute[] => [
  ...workspaceRoutes({ layers: LAYERS, ws: over.ws }),
  { method: "GET", path: /\/maps\/[^/]+$/, body: over.map ?? exampleGeoMap },
  {
    method: "GET",
    path: /\/findings\/[^/]+$/,
    status: findingStatus,
    body: finding,
  },
];

/** The probe sits outside the routes, so it still reports after a navigation to /images/… . */
function arrive(routes: FakeRoute[], search: string) {
  render(
    <TestApiProvider api={fakeClient(routes).api}>
      <MemoryRouter initialEntries={[`/p/${PROJECT_ID}/maps?${search}`]}>
        <Routes>
          <Route path="/p/:projectId/maps" element={<MapWorkspace />} />
          <Route path="*" element={null} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </TestApiProvider>,
  );
}

beforeEach(() => {
  fakeView.centreOn.mockClear();
  fakeView.fit.mockClear();
  useToastStore.getState().clear();
});

describe("the ?finding= arrival (spec §5, §9.4, §15)", () => {
  it("centres on the anchor, opens the inspector and takes the map's date as r", async () => {
    arrive(base(onMap), `map=${MAP_ID}&finding=${FINDING_ID_2}`);
    expect(await screen.findByRole("complementary", { name: "Finding" })).toHaveTextContent(FINDING_ID_2);
    await waitFor(() => expect(fakeView.centreOn).toHaveBeenCalledTimes(1));
    const [[e, n], res] = fakeView.centreOn.mock.calls[0];
    expect(e).toBeGreaterThan(500000);
    expect(e).toBeLessThan(502400);
    expect(n).toBeGreaterThan(4981200);
    expect(n).toBeLessThan(4983000);
    expect(res).toBe(0.05);
    const loc = screen.getByTestId("location").textContent ?? "";
    expect(loc).toContain(`sel=finding%3A${FINDING_ID_2}`);
    expect(loc).toContain("r=2026-04-15");
    expect(loc).not.toContain("finding=");
    expect(loc).not.toContain("map=");
    expect(fakeView.fit).not.toHaveBeenCalled();
  });

  it("redirects a finding anchored on another map to its own map", async () => {
    arrive(base(onMap), `map=someone-else&finding=${FINDING_ID_2}`);
    await waitFor(() => expect(fakeView.centreOn).toHaveBeenCalledTimes(1));
    // It went through maps?map=<its map>&finding=… and then arrived; the URL write lands after the centring.
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(`sel=finding%3A${FINDING_ID_2}`),
    );
    expect(screen.getByTestId("location")).not.toHaveTextContent("map=");
  });

  it("sends an image finding to its image", async () => {
    arrive(
      base({ ...exampleFinding, attachment_count: 0, comment_count: 0 }),
      `map=${MAP_ID}&finding=${FINDING_ID}`,
    );
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/\/images\/.+\?finding=/));
  });

  it("toasts once and drops the params when the finding is gone (Review Focus 5)", async () => {
    arrive(
      base({ error: { code: "not_found", message: "no such finding" } }, 404),
      `map=${MAP_ID}&finding=nope`,
    );
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      tone: "danger",
    });
    await waitFor(() => expect(screen.getByTestId("location")).not.toHaveTextContent("finding="));
    // I2: it could not centre and there is no saved view, so the site is fitted (not a blank stage).
    await waitFor(() => expect(fakeView.fit).toHaveBeenCalledTimes(1));
    expect(fakeView.centreOn).not.toHaveBeenCalled();
  });

  it("does not fit over a saved view when the finding is gone", async () => {
    const saved = { center: [501000, 4982000], resolution: 0.2, rotation: 0 };
    arrive(
      base({ error: { code: "not_found", message: "no such finding" } }, 404, {
        ws: { ...WS, state: { v: 1, view: saved } },
      }),
      `map=${MAP_ID}&finding=nope`,
    );
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId("location")).not.toHaveTextContent("finding="));
    expect(fakeView.fit).not.toHaveBeenCalled();
  });

  it("takes the map's date as r in Single, even from a saved compare mode (M2)", async () => {
    arrive(
      base(onMap, 200, {
        ws: { ...WS, state: { v: 1, mode: "swipe" } },
        map: { ...exampleGeoMap, captured_on: "2026-03-01" },
      }),
      `map=${MAP_ID}&finding=${FINDING_ID_2}`,
    );
    await waitFor(() => expect(fakeView.centreOn).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(`sel=finding%3A${FINDING_ID_2}`),
    );
    const loc = screen.getByTestId("location").textContent ?? "";
    expect(loc).toContain("r=2026-03-01");
    expect(loc).not.toContain("mode=");
    expect(screen.getByTestId("site-map")).toHaveAttribute("data-mode", "single");
  });
});

describe("sel and tool survive a ?map= arrival (R-P1)", () => {
  it("applies ?sel=run:<id> after the map arrival settles", async () => {
    arrive(base(onMap), `map=${MAP_ID}&sel=run:r1`);
    await waitFor(() => expect(screen.getByTestId("map-inspector")).toHaveAttribute("data-sel", "run:r1"));
    await waitFor(() => expect(screen.getByTestId("location")).not.toHaveTextContent("map="));
    const loc = screen.getByTestId("location").textContent ?? "";
    expect(loc).toContain("sel=run%3Ar1");
    expect(loc).toContain("r=2026-04-15");
  });

  it("arms ?tool=zone after the map arrival settles", async () => {
    arrive(base(onMap), `map=${MAP_ID}&tool=zone`);
    await waitFor(() => expect(screen.getByTestId("location")).not.toHaveTextContent("map="));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Zone/ })).toHaveAttribute("aria-pressed", "true"),
    );
    expect(screen.getByTestId("location")).not.toHaveTextContent("tool=");
  });
});
