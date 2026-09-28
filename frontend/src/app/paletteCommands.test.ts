import { describe, expect, it, vi } from "vitest";
import { errorBody, exampleClasses, fakeClient, PROJECT_ID } from "@/test/fixtures";
import {
  actionCommands,
  dataHref,
  formatFindingNumber,
  goToCommands,
  projectSearchSources,
} from "./paletteCommands";
import { defaultRouteActions } from "./routeActions";
import { routeInfo } from "./routeModel";

describe("palette commands", () => {
  it("go to: the sections everywhere; the tabs, pages and other recent projects inside a project", () => {
    const go = vi.fn();
    const outside = goToCommands(routeInfo("/projects"), [{ id: "p2", name: "North site" }], go);
    expect(outside.map((c) => c.title)).toEqual([
      "Projects",
      "Models",
      "Catalogue",
      "Jobs",
      "Settings",
      "North site",
    ]);
    const inside = goToCommands(
      routeInfo(`/p/${PROJECT_ID}/images`),
      [{ id: PROJECT_ID, name: "Ahmadia" }],
      go,
    );
    const titles = inside.map((c) => c.title);
    expect(titles).toContain("Point clouds");
    expect(titles).toContain("Site areas");
    expect(titles).not.toContain("Ahmadia");
    inside.find((c) => c.title === "Findings")?.run();
    expect(go).toHaveBeenCalledWith(`/p/${PROJECT_ID}/findings`);
  });

  it("go to Jobs keeps the project, like the rail", () => {
    const go = vi.fn();
    goToCommands(routeInfo(`/p/${PROJECT_ID}/images`), [], go)
      .find((c) => c.id === "go:jobs")
      ?.run();
    expect(go).toHaveBeenCalledWith(`/jobs?project=${PROJECT_ID}`);
    go.mockClear();
    goToCommands(routeInfo("/projects"), [], go)
      .find((c) => c.id === "go:jobs")
      ?.run();
    expect(go).toHaveBeenCalledWith("/jobs");
  });

  it("actions: the route's enabled actions, the importers, New project and reduced effects", () => {
    const go = vi.fn();
    const addData = vi.fn();
    const toggleEffects = vi.fn();
    const info = routeInfo(`/p/${PROJECT_ID}/findings`);
    const cmds = actionCommands({
      info,
      actions: defaultRouteActions(info, vi.fn()),
      go,
      addData,
      toggleEffects,
    });
    expect(cmds.map((c) => c.title)).toEqual([
      "Add data",
      "Generate report",
      "Add photos",
      "Add an orthomosaic",
      "Add an elevation model",
      "Add a point cloud",
      "Add a drawing",
      "New project",
      "Toggle reduced effects",
    ]);
    cmds.find((c) => c.title === "Generate report")?.run();
    expect(go).toHaveBeenCalledWith(`/p/${PROJECT_ID}/reports`);
    cmds.find((c) => c.title === "Add a point cloud")?.run();
    expect(addData).toHaveBeenCalledWith("point_cloud");
    cmds.find((c) => c.title === "New project")?.run();
    expect(go).toHaveBeenCalledWith("/projects?new=1");
    cmds.find((c) => c.title === "Toggle reduced effects")?.run();
    expect(toggleEffects).toHaveBeenCalled();
  });

  it("offers no importers while the project is still loading (Add data is disabled)", () => {
    const info = routeInfo(`/p/${PROJECT_ID}/images`);
    const cmds = actionCommands({
      info,
      actions: defaultRouteActions(info, null),
      go: vi.fn(),
      addData: vi.fn(),
      toggleEffects: vi.fn(),
    });
    expect(cmds.map((c) => c.title)).toEqual(["Generate report", "New project", "Toggle reduced effects"]);
  });

  it("numbers findings F- plus at least four digits", () => {
    expect(formatFindingNumber(7)).toBe("F-0007");
    expect(formatFindingNumber(217)).toBe("F-0217");
    expect(formatFindingNumber(12345)).toBe("F-12345");
  });

  it("links each data type to where it opens", () => {
    expect(dataHref("p", { id: "m1", type: "map" })).toBe("/p/p/maps?map=m1");
    expect(dataHref("p", { id: "c1", type: "point_cloud" })).toBe("/p/p/clouds/c1");
    expect(dataHref("p", { id: "s1", type: "image_set" })).toBe("/p/p/images");
    expect(dataHref("p", { id: "e1", type: "elevation" })).toBe("/p/p/maps?sel=surface:e1");
    expect(dataHref("p", { id: "d1", type: "drawing" })).toBe("/p/p/maps?sel=drawing:d1");
  });

  it("searches findings and data in two groups, naming the type from the project's classes", async () => {
    const { api, requests } = fakeClient(
      [
        {
          method: "GET",
          path: /\/search$/,
          body: {
            findings: [
              {
                id: "f1",
                number: 217,
                type_id: exampleClasses[0].id,
                note: "Crack along the north face of column C4, 40cm",
              },
            ],
            data: [
              {
                id: "m1",
                type: "map",
                label: "May survey",
                captured_on: null,
                status: "ready",
                summary: {},
                created_at: "2026-05-20T00:00:00Z",
              },
            ],
          },
        },
      ],
      { signalSafe: true },
    );
    const go = vi.fn();
    const [findings, data] = projectSearchSources(api, PROJECT_ID, exampleClasses, go);
    expect([findings.label, data.label]).toEqual(["Findings", "Data"]);
    expect([findings.minQuery, data.minQuery]).toEqual([2, 2]);
    const signal = new AbortController().signal;
    const [found, items] = await Promise.all([findings.search("cr", signal), data.search("cr", signal)]);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(`/api/v1/projects/${PROJECT_ID}/search?q=cr&limit=8`);
    expect(found[0].title).toBe(`F-0217 · ${exampleClasses[0].name}`);
    expect(found[0].hint).toBe("Crack along the north face of column C4, 40cm");
    found[0].run();
    expect(go).toHaveBeenCalledWith(`/p/${PROJECT_ID}/findings/f1`);
    expect(items[0]).toMatchObject({ title: "May survey", hint: "Orthomosaic" });
  });

  it("never replays an aborted request: retyping the same query after an abort makes a fresh one", async () => {
    const { api, requests } = fakeClient(
      [{ method: "GET", path: /\/search$/, body: { findings: [], data: [] } }],
      {
        signalSafe: true,
      },
    );
    const go = vi.fn();
    const [findings] = projectSearchSources(api, PROJECT_ID, exampleClasses, go);
    // A prior debounce cycle for "cr" that was cancelled: its signal is already aborted.
    const cancelled = new AbortController();
    cancelled.abort();
    await findings.search("cr", cancelled.signal);
    expect(requests).toHaveLength(1);
    // Retyping the same "cr" starts a new debounce cycle with a live signal: must not reuse the
    // abandoned request (that would leave the palette waiting on a promise nothing resolves again).
    const fresh = new AbortController();
    await findings.search("cr", fresh.signal);
    expect(requests).toHaveLength(2);
  });

  it("never caches a failed search: retyping the same query after a failure tries again", async () => {
    // The first call fails (500); every call after answers 200 with empty results, simulating the
    // backend recovering by the time the same query is retyped.
    let calls = 0;
    const { api } = fakeClient(
      [
        {
          method: "GET",
          path: /\/search$/,
          status: () => (++calls === 1 ? 500 : 200),
          body: () => (calls === 1 ? errorBody("http_error", "boom") : { findings: [], data: [] }),
        },
      ],
      { signalSafe: true },
    );
    const go = vi.fn();
    const [findings] = projectSearchSources(api, PROJECT_ID, exampleClasses, go);
    const c1 = new AbortController();
    await expect(findings.search("cr", c1.signal)).rejects.toThrow();
    const c2 = new AbortController();
    const items = await findings.search("cr", c2.signal);
    expect(calls).toBe(2);
    expect(items).toEqual([]);
  });
});
