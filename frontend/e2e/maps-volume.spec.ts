import { test, expect } from "@playwright/test";
import { evidencePath } from "./evidence";
import {
  AUG,
  DSM_AUG,
  DSM_SEP,
  P,
  SEP,
  SITE,
  drawSite,
  enableDiagnostics,
  serveMapWorkspace,
} from "./fixtures/mapWorkspace";

// Spec M §15 flow 4 and §10: the polygon becomes POST /volumes on the right date's DSM; a base card
// change is PATCH + calculate; the numbers come only from the job (dimmed while calculating). The
// fake's net depends on the stored base: toe_lowest 1412.6, toe_plane 1234.5, surface 1101.2, and it
// reads `ready` on the first GET after a calculate; `GET /jobs/:id` answers succeeded (R-P3), so the
// inspector reloads the volume once the job ends. `createFromRing` starts at `toe_plane`.

test.beforeEach(async ({ page }) => {
  await enableDiagnostics(page);
});

type Call = { method: string; path: string; body: unknown };

const basePatches = (calls: Call[]) =>
  calls
    .filter((c) => c.method === "PATCH" && /^\/volumes\/[^/]+$/.test(c.path))
    .map((c) => (c.body as { base?: { kind: string } }).base?.kind)
    .filter((k): k is string => k !== undefined);

const calculates = (calls: Call[]) =>
  calls.filter((c) => c.method === "POST" && /^\/volumes\/[^/]+\/calculate$/.test(c.path)).length;

test("flow 4: volume on a stockpile, base cards change the numbers after the job, heatmap", async ({
  page,
}) => {
  const world = await serveMapWorkspace(page);
  // The heatmap switch is on by default (`volumeStore.ts`, a remembered preference); start this
  // operator with it off so the flow switches it on.
  await page.addInitScript(() => localStorage.setItem("kestrel.mapws.heatmap", "0"));
  await page.goto(`/p/${P}/maps?l=${AUG}&r=${SEP}`);
  await expect(page.getByTestId("map-workspace")).toBeVisible();
  // R-URL: the settled address only.
  await expect(page).toHaveURL(new RegExp(`/p/${P}/maps(\\?|$)`));

  // A 30 × 30 m ring around the stockpile at the site centre.
  await drawSite(page, "u", [
    [SITE.cE - 15, SITE.cN + 15],
    [SITE.cE + 15, SITE.cN + 15],
    [SITE.cE + 15, SITE.cN - 15],
    [SITE.cE - 15, SITE.cN - 15],
  ]);
  await expect
    .poll(() => world.calls.filter((c) => c.method === "POST" && c.path === "/volumes").length)
    .toBe(1);
  const create = world.calls.find((c) => c.method === "POST" && c.path === "/volumes")!.body as {
    top_surface_id: string;
    polygon_site?: number[][];
    base: { kind: string };
  };
  // The top is the right-hand (September) survey's DSM.
  expect(create.top_surface_id).toBe(DSM_SEP);
  expect(create.polygon_site).toHaveLength(4);
  expect(create.base.kind).toBe("toe_plane");

  const inspector = page.getByTestId("map-inspector");
  await expect(inspector).toHaveAttribute("data-sel", /^volume:/);
  const net = inspector.getByTestId("volume-net");
  const settled = inspector.getByTestId("volume-numbers");
  const bases = inspector.getByRole("radiogroup", { name: "Base surface" });

  // The create's own job: Best-fit plane, the starting base.
  await expect(settled).toBeVisible();
  await expect(net).toContainText("1 234.5");
  await expect(bases.getByRole("radio", { name: "Best-fit plane" })).toHaveAttribute("aria-checked", "true");

  const pick = async (name: string, value: string) => {
    const card = bases.getByRole("radio", { name });
    await card.click();
    await expect(card).toHaveAttribute("aria-checked", "true");
    await expect(settled).toBeVisible();
    await expect(net).toContainText(value);
  };
  await pick("Lowest point", "1 412.6");
  await pick("Best-fit plane", "1 234.5");
  await pick("Earlier survey", "1 101.2");

  expect(basePatches(world.calls)).toEqual(["toe_lowest", "toe_plane", "surface"]);
  expect(calculates(world.calls)).toBe(3);
  // "Earlier survey" is the August DSM: the one earlier survey in this world.
  const last = world.calls.filter((c) => c.method === "PATCH" && /^\/volumes\//.test(c.path)).at(-1)!
    .body as { base: { kind: string; surface_id?: string } };
  expect(last.base).toEqual({ kind: "surface", surface_id: DSM_AUG });

  // The map's Volumes layer re-reads its list only on `volumes.changed`, which the real calculate
  // job publishes when it ends (`backend/app/volumes/jobs_calc.py`). The fake only sends
  // `job.state`, so send that event here; without it the layer keeps the create-time copy (no
  // results) and draws no heatmap.
  world.sendEvent("volumes.changed", { measurement_ids: [String(world.volumes[0].id)] });

  // Heatmap: volume_diff site tiles (§10), none while the switch is off.
  expect(world.tiles.filter((t) => t.startsWith("volume_diff/"))).toEqual([]);
  const diff = page.waitForRequest((r) => /\/site-tiles\/volume_diff\//.test(r.url()));
  const heat = inspector.getByRole("switch", { name: "Cut / fill heatmap" });
  await heat.click();
  await expect(heat).toBeChecked();
  expect((await diff).url()).toContain(`/volume_diff/${String(world.volumes[0].id)}/`);
  await expect(inspector.getByText("above base")).toBeVisible();
  await page.screenshot({ path: evidencePath("maps", "flow4-volume.png") });
});
