import { describe, expect, it } from "vitest";
import { PROJECT_TABS, RAIL_ENTRIES, RAIL_SETTINGS, layoutOf, routeInfo } from "./routeModel";

describe("routeInfo", () => {
  it.each([
    ["/", "projects", null, "Projects"],
    ["/projects", "projects", null, "Projects"],
    ["/p/abc", "projects", "overview", "Overview"],
    ["/p/abc/overview", "projects", "overview", "Overview"],
    ["/p/abc/images", "projects", "images", "Images"],
    ["/p/abc/images/i1", "projects", "images", "Images"],
    ["/p/abc/maps/m1", "projects", "maps", "Maps"],
    ["/p/abc/clouds/c1", "projects", "clouds", "Point clouds"],
    ["/p/abc/findings/f1", "projects", "findings", "Findings"],
    ["/p/abc/measurements", "projects", "measurements", "Measurements"],
    ["/p/abc/runs", "projects", null, "Runs"],
    ["/p/abc/query", "projects", null, "Detect"],
    ["/p/abc/site-areas", "projects", null, "Site areas"],
    ["/p/abc/settings", "projects", null, "Project settings"],
    ["/models", "models", null, "Library"],
    ["/models/datasets/d1", "models", null, "Datasets"],
    ["/models/training", "models", null, "Training"],
    ["/catalogue", "catalogue", null, "Types"],
    ["/catalogue/severity", "catalogue", null, "Severity"],
    ["/jobs", "jobs", null, "Jobs"],
    ["/settings", "settings", null, "Settings"],
    ["/about", "settings", null, "About"],
    ["/nowhere", null, null, null],
  ])("%s is section %s, tab %s, page %s", (path, section, tab, page) => {
    const info = routeInfo(path);
    expect(info.section).toBe(section);
    expect(info.tab).toBe(tab);
    expect(info.page).toBe(page);
  });

  it("reads the project id only inside a project", () => {
    expect(routeInfo("/p/abc/images").projectId).toBe("abc");
    expect(routeInfo("/models/library").projectId).toBeNull();
  });

  it("frames pages: the images workspace keeps the tabs, the map workspace is full-bleed", () => {
    expect(routeInfo("/p/a/images").layout).toBe("page");
    expect(routeInfo("/p/a/images/i1").layout).toBe("workspace");
    expect(routeInfo("/p/a/maps").layout).toBe("page");
    expect(routeInfo("/p/a/maps/m1").layout).toBe("fullbleed");
    expect(routeInfo("/p/a/clouds/c1").layout).toBe("page");
    expect(layoutOf("findings", true)).toBe("page");
  });

  it("keys transitions on the tab, never on an item inside it", () => {
    const key = (p: string) => routeInfo(p).transitionKey;
    expect(key("/p/a/findings")).toBe(key("/p/a/findings/f1"));
    expect(key("/p/a/images")).toBe(key("/p/a/images/i1"));
    expect(key("/p/a")).toBe(key("/p/a/overview"));
    expect(key("/p/a/images")).not.toBe(key("/p/a/maps"));
    expect(key("/models/datasets")).toBe(key("/models/datasets/d1"));
    expect(key("/models/library")).not.toBe(key("/models/datasets"));
    expect(key("/")).toBe(key("/projects"));
  });

  it("has the seven tabs and the rail entries in the spec's order", () => {
    expect(PROJECT_TABS.map((t) => t.label)).toEqual([
      "Overview",
      "Images",
      "Maps",
      "Point clouds",
      "Findings",
      "Measurements",
      "Reports",
    ]);
    expect([...RAIL_ENTRIES, RAIL_SETTINGS].map((e) => e.label)).toEqual([
      "Projects",
      "Models",
      "Catalogue",
      "Jobs",
      "Settings",
    ]);
  });
});
