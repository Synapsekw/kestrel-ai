import createClient from "openapi-fetch";
import type { ApiClient, paths } from "@contract/client";
import { describe, expect, it, vi } from "vitest";
import { errorBody, exampleClasses, PROJECT_ID, type FakeRoute, type RecordedRequest } from "@/test/fixtures";
import {
  actionCommands,
  dataHref,
  formatFindingNumber,
  goToCommands,
  projectSearchSources,
} from "./paletteCommands";
import { defaultRouteActions } from "./routeActions";
import { routeInfo } from "./routeModel";

/**
 * jsdom (via its bundled, private `undici`) validates a `Request`'s `signal` against undici's own
 * `AbortSignal` class, not the DOM `AbortController`/`AbortSignal` that `new AbortController()`
 * returns under Vitest's jsdom environment — so `openapi-fetch`'s internal `new Request(url, {
 * signal })` throws "Expected signal to be an instance of AbortSignal" for any *real* signal,
 * regardless of which `fetch` implementation is supplied (reproduces with a bare `new Request(url,
 * {signal: new AbortController().signal})`, no app code involved). This is a test-environment-only
 * defect — the production app runs in a real browser/webview, where these classes agree — so tests
 * that must thread a live `AbortSignal` through `unwrap(api.GET(...))` build their client with a
 * plain-object `Request` stand-in instead of `globalThis.Request`, sidestepping the broken check
 * while still exercising the real cache/abort logic under test.
 */
class SafeRequest {
  readonly url: string;
  readonly method: string;
  readonly signal?: AbortSignal | null;
  constructor(url: string, init: RequestInit = {}) {
    this.url = url;
    this.method = init.method ?? "GET";
    this.signal = init.signal;
  }
}

function signalSafeClient(routes: FakeRoute[]): { api: ApiClient; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (input: unknown) => {
    const req = input as SafeRequest;
    const url = new URL(req.url);
    const rec: RecordedRequest = { method: req.method, url: url.pathname + url.search, body: null };
    requests.push(rec);
    const route = routes.find((r) => r.method === req.method && r.path.test(url.pathname));
    if (!route) {
      return new Response(
        JSON.stringify(errorBody("not_found", `no fake route for ${req.method} ${url.pathname}`)),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    const status = route.status ?? 200;
    const payload = typeof route.body === "function" ? route.body(rec) : route.body;
    if (status === 204 || payload === undefined) return new Response(null, { status });
    return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const api = createClient<paths>({
    baseUrl: "http://fake",
    fetch: fetchImpl,
    Request: SafeRequest as unknown as typeof Request,
  });
  return { api: api as ApiClient, requests };
}

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

  it("numbers findings F- plus at least four digits", () => {
    expect(formatFindingNumber(7)).toBe("F-0007");
    expect(formatFindingNumber(217)).toBe("F-0217");
    expect(formatFindingNumber(12345)).toBe("F-12345");
  });

  it("links each data type to where it opens", () => {
    expect(dataHref("p", { id: "m1", type: "map" })).toBe("/p/p/maps/m1");
    expect(dataHref("p", { id: "c1", type: "point_cloud" })).toBe("/p/p/clouds/c1");
    expect(dataHref("p", { id: "s1", type: "image_set" })).toBe("/p/p/images");
    expect(dataHref("p", { id: "e1", type: "elevation" })).toBe("/p/p/measurements");
    expect(dataHref("p", { id: "d1", type: "drawing" })).toBe("/p/p/maps");
  });

  it("searches findings and data in two groups, naming the type from the project's classes", async () => {
    const { api, requests } = signalSafeClient([
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
    ]);
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
    const { api, requests } = signalSafeClient([
      { method: "GET", path: /\/search$/, body: { findings: [], data: [] } },
    ]);
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
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify(errorBody("http_error", "boom")), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ findings: [], data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const api = createClient<paths>({
      baseUrl: "http://fake",
      fetch: fetchImpl,
      Request: SafeRequest as unknown as typeof Request,
    }) as ApiClient;
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
