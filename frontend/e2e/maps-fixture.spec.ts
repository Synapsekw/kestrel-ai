import { expect, test } from "@playwright/test";
import { measureFrames } from "./frameTime";
import { enableDiagnostics, P, serveMapWorkspace, SITE, sitePixel } from "./fixtures/mapWorkspace";

// The M-X e2e fixtures prove themselves once: the fake world opens the workspace with its layers,
// the diagnostics hook maps a site coordinate to a pixel inside the map, and the frame sampler
// returns a real sample. The flows (maps-*.spec.ts) build on exactly these helpers.

test("the fake map world opens the workspace, places site coordinates and samples frames", async ({
  page,
}) => {
  await enableDiagnostics(page);
  const world = await serveMapWorkspace(page);
  await page.goto(`/p/${P}/maps`);

  const ws = page.getByTestId("map-workspace");
  await expect(ws).toBeVisible();
  await expect(ws).toHaveAttribute("data-frame", "crs");
  await expect(page.getByTestId("coord-readout")).toContainText("EPSG:32633");
  // Both orthos, both DSMs and the design surface are listed.
  await expect(page.locator('[data-testid="layer-row"][data-kind="map"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="layer-row"][data-kind="surface"]').first()).toBeVisible();

  const box = (await page.getByTestId("site-map").boundingBox())!;
  const c = await sitePixel(page, SITE.cE, SITE.cN);
  expect(c.x).toBeGreaterThan(box.x);
  expect(c.x).toBeLessThan(box.x + box.width);
  expect(c.y).toBeGreaterThan(box.y);
  expect(c.y).toBeLessThan(box.y + box.height);
  // North is up and east is right.
  const ne = await sitePixel(page, SITE.cE + 10, SITE.cN + 10);
  expect(ne.x).toBeGreaterThan(c.x);
  expect(ne.y).toBeLessThan(c.y);

  await expect.poll(() => world.tiles.some((t) => t.startsWith("map/"))).toBe(true);
  expect(world.calls.some((x) => x.method === "GET" && x.path === "/map-workspace/layers")).toBe(true);

  const frames = await measureFrames(page, { warmupMs: 200, durationMs: 1500 });
  expect(frames.samples).toBeGreaterThanOrEqual(60);
  expect(frames.p95).toBeGreaterThan(0);
});

test("a fake volume job finishes and the read after it carries the base's numbers", async ({ page }) => {
  const world = await serveMapWorkspace(page);
  await page.goto(`/p/${P}/maps`);
  await expect(page.getByTestId("map-workspace")).toBeVisible();

  // A volume's job answers succeeded; a read after the calculate has the base's numbers.
  const created = await page.evaluate(
    async ([api, surface]) => {
      const r = await fetch(`${api}/volumes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Pile", top_surface_id: surface, base: { kind: "toe_lowest" } }),
      });
      const b = (await r.json()) as { measurement: { id: string; job_id: string } };
      const job = await (await fetch(`${api}/jobs/${b.measurement.job_id}`)).json();
      const vol = await (await fetch(`${api}/volumes/${b.measurement.id}`)).json();
      return { status: r.status, job, vol };
    },
    [`/api/v1/projects/${P}`, world.surfaces[0].id as string] as const,
  );
  expect(created.status).toBe(202);
  expect(created.job.state).toBe("succeeded");
  expect(created.vol).toMatchObject({ status: "ready", results: { net_m3: 1412.6 } });

  // Layer max_zoom follows the backend's maxZoomFor(native res): 3 cm maps 17, 10 cm DSMs 15.
  const layers = await page.evaluate(async (api) => {
    const r = await fetch(`${api}/map-workspace/layers`);
    return ((await r.json()) as { items: { kind: string; max_zoom: number | null }[] }).items;
  }, `/api/v1/projects/${P}`);
  expect(layers.filter((l) => l.kind === "map").map((l) => l.max_zoom)).toEqual([17, 17]);
  expect(layers.filter((l) => l.kind === "surface").map((l) => l.max_zoom)).toEqual([15, 15, 15]);
});

test("an event the fake sends reaches the app over the routed events socket", async ({ page }) => {
  const world = await serveMapWorkspace(page);
  await page.goto(`/p/${P}/maps`);
  await expect(page.getByTestId("map-workspace")).toBeVisible();
  // `drawings.changed` bumps the workspace revision, and the layers list re-reads only on that.
  const reads = () => world.calls.filter((c) => c.path === "/map-workspace/layers").length;
  // Wait for the load's own reads to stop: the same count on three polls in a row.
  let last = -1;
  let same = 0;
  await expect
    .poll(
      () => {
        const n = reads();
        same = n > 0 && n === last ? same + 1 : 0;
        last = n;
        return same;
      },
      { intervals: [250] },
    )
    .toBeGreaterThanOrEqual(2);
  const before = reads();
  world.sendEvent("drawings.changed", { ids: [] });
  await expect.poll(reads).toBeGreaterThan(before);
});
