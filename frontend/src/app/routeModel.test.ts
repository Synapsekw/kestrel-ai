import { describe, expect, it } from "vitest";
import {
  PROJECT_TABS,
  RAIL_ENTRIES,
  RAIL_SETTINGS,
  SECONDARY_PAGES,
  layoutOf,
  routeInfo,
  secondaryHref,
  SIDEBAR_NARROW_WIDTH,
  isForcedCollapse,
  sidebarCollapsed,
  topBarTitle,
  secondaryOf,
} from "./routeModel";

describe("routeInfo", () => {
  it.each([
    ["/", "projects", null, "Projects"],
    ["/projects", "projects", null, "Projects"],
    ["/projects/new", "projects", null, "New project"],
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

  it("a secondary page's href: Review opens the runs picker, the rest are bare (I-FW I3)", () => {
    const page = (id: string) => SECONDARY_PAGES.find((p) => p.id === id)!;
    expect(secondaryHref("abc", page("review"))).toBe("/p/abc/review?view=runs");
    expect(secondaryHref("abc", page("analytics"))).toBe("/p/abc/analytics");
    expect(routeInfo("/p/abc/review").page).toBe("Review");
  });

  it("reads the project id only inside a project", () => {
    expect(routeInfo("/p/abc/images").projectId).toBe("abc");
    expect(routeInfo("/models/library").projectId).toBeNull();
  });

  it("frames pages: the images workspace keeps the tabs, the map workspace is full-bleed at its list and its maps", () => {
    expect(routeInfo("/p/a/images").layout).toBe("workspace");
    expect(routeInfo("/p/a/images/i1").layout).toBe("workspace");
    expect(routeInfo("/p/a/maps").layout).toBe("fullbleed");
    expect(routeInfo("/p/a/maps/m1").layout).toBe("fullbleed");
    expect(routeInfo("/p/a/clouds").layout).toBe("page");
    expect(routeInfo("/p/a/clouds/c1").layout).toBe("fullbleed");
    expect(layoutOf("models", false)).toBe("fullbleed");
    expect(PROJECT_TABS.map((t) => t.id)).toContain("models");
    expect(layoutOf("findings", true)).toBe("page");
    // R7: the report builder fills the page under the tabs; the list and Data exports are pages.
    expect(routeInfo("/p/a/reports").layout).toBe("page");
    expect(routeInfo("/p/a/reports/r1").layout).toBe("workspace");
    expect(routeInfo("/p/a/reports/exports").layout).toBe("page");
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
    expect(key("/projects")).not.toBe(key("/projects/new"));
  });

  it("has the project tabs and the rail entries in order", () => {
    expect(PROJECT_TABS.map((t) => t.label)).toEqual([
      "Overview",
      "Images",
      "Maps",
      "Drawings",
      "Point clouds",
      "Asset models",
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

describe("sidebar rules", () => {
  it("forces collapse on full-bleed layouts and narrow windows only", () => {
    expect(isForcedCollapse("fullbleed", 1600)).toBe(true);
    expect(isForcedCollapse("page", 1099)).toBe(true);
    expect(isForcedCollapse("page", SIDEBAR_NARROW_WIDTH)).toBe(false);
    expect(isForcedCollapse("workspace", 1280)).toBe(true);
    expect(routeInfo("/p/p1/images").layout).toBe("workspace");
    expect(routeInfo("/p/p1/maps").layout).toBe("fullbleed");
    expect(routeInfo("/p/p1/models").layout).toBe("fullbleed");
    expect(routeInfo("/p/p1/clouds/c1").layout).toBe("fullbleed");
    expect(routeInfo("/p/p1/clouds").layout).toBe("page");
  });

  it("uses the stored preference unless forced, and a per-visit override when forced", () => {
    expect(sidebarCollapsed(false, false, null)).toBe(false);
    expect(sidebarCollapsed(true, false, null)).toBe(true);
    expect(sidebarCollapsed(false, false, true)).toBe(false); // the override only counts when forced
    expect(sidebarCollapsed(false, true, null)).toBe(true);
    expect(sidebarCollapsed(true, true, false)).toBe(false);
    expect(sidebarCollapsed(false, true, true)).toBe(true);
  });

  it.each([
    ["/projects", "Projects"],
    ["/projects/new", "Projects · New project"],
    ["/models", "Models · Library"],
    ["/models/datasets", "Models · Datasets"],
    ["/catalogue", "Catalogue · Types"],
    ["/catalogue/severity", "Catalogue · Severity"],
    ["/jobs", "Jobs"],
    ["/settings", "Settings"],
    ["/about", "Settings · About"],
    ["/p/p1/overview", "Overview"],
    ["/p/p1/maps/m1/evaluate", "Maps"],
    ["/p/p1/runs", "Runs"],
    ["/p/p1/site-areas", "Site areas"],
    ["/p/p1/nowhere", "Project"],
    ["/no/such/page", ""],
  ])("titles %s as %j", (path, title) => {
    expect(topBarTitle(routeInfo(path))).toBe(title);
  });

  it("names the secondary page of a project path", () => {
    expect(secondaryOf("/p/p1/runs")).toBe("runs");
    expect(secondaryOf("/p/p1/review")).toBe("review");
    expect(secondaryOf("/p/p1/settings")).toBe("settings");
    expect(secondaryOf("/p/p1/findings")).toBeNull();
    expect(secondaryOf("/settings")).toBeNull();
  });
});
