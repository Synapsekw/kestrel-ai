import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { enableDiagnostics, sitePixel } from "./fixtures/mapWorkspace";

// Spec 2026-09-26-map-workspace §15 "then one real-backend flow": the real site frame, real warped
// site tiles for two orthos in different extents, Swipe, and a distance the server computes on the
// ellipsoid. Skipped in the gate; playwright.real-backend.config.ts sets E2E_REAL_BACKEND.
test.skip(process.env.E2E_REAL_BACKEND !== "1", "opt-in: -c playwright.real-backend.config.ts");

const API = `http://127.0.0.1:${process.env.E2E_API_PORT}/api/v1`;
const auth = { Authorization: `Bearer ${process.env.E2E_API_TOKEN}` };

async function waitJob(request: APIRequestContext, pid: string, jid: string) {
  await expect
    .poll(
      async () =>
        (
          (await (await request.get(`${API}/projects/${pid}/jobs/${jid}`, { headers: auth })).json()) as {
            state: string;
          }
        ).state,
      { timeout: 120_000, intervals: [500] },
    )
    .toBe("succeeded");
}

test("real backend: two orthos in one frame, Swipe, and a server-computed distance", async ({
  page,
  request,
}) => {
  const root = join(process.env.E2E_DATA_DIR!, `run-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  const data = JSON.parse(
    execFileSync(process.env.KESTREL_PYTHON!, ["scripts/make_maps_e2e_data.py", join(root, "data")], {
      cwd: "../backend",
    }).toString(),
  ) as { aug: string; sep: string; origin: [number, number] };

  const created = await request.post(`${API}/projects`, {
    headers: auth,
    data: { name: "Maps e2e", folder: join(root, "project") },
  });
  expect(created.status()).toBe(201);
  const pid = ((await created.json()) as { id: string }).id;
  for (const [path, date] of [
    [data.aug, "2026-08-14"],
    [data.sep, "2026-09-14"],
  ] as const) {
    const r = await request.post(`${API}/projects/${pid}/maps`, { headers: auth, data: { path } });
    expect(r.status()).toBe(202);
    const { map, job } = (await r.json()) as { map: { id: string }; job: { id: string } };
    await waitJob(request, pid, job.id);
    const dated = await request.patch(`${API}/projects/${pid}/maps/${map.id}`, {
      headers: auth,
      data: { captured_on: date },
    });
    expect(dated.ok()).toBe(true);
  }

  await enableDiagnostics(page);
  const tile = page.waitForResponse((r) => /\/site-tiles\/map\//.test(r.url()) && r.status() === 200);
  await page.goto(`/p/${pid}/maps?l=2026-08-14&r=2026-09-14`);
  await expect(page.getByTestId("coord-readout")).toContainText("EPSG:32633");
  expect((await tile).headers()["content-type"]).toContain("image/png");
  await expect(page.getByTestId("layer-row").filter({ hasText: "14 Aug 2026" })).toBeVisible();
  await expect(page.getByTestId("layer-row").filter({ hasText: "14 Sep 2026" })).toBeVisible();

  await page.getByRole("radio", { name: "Swipe" }).click();
  await expect(page.getByRole("slider", { name: "Swipe divider" })).toBeVisible();

  // 30 m east + 40 m south of a point inside both orthos: 50 m grid; UTM 33N at its central
  // meridian scales by 0.9996, so the ellipsoidal length is about 50.02 m. Tool keys are
  // window-level (`site-map` is not focusable), so nothing is focused first.
  const [e0, n0] = [data.origin[0] + 40, data.origin[1] - 30];
  await page.keyboard.press("l");
  for (const [e, n] of [
    [e0, n0],
    [e0 + 30, n0 - 40],
  ]) {
    const p = await sitePixel(page, e, n);
    await page.mouse.click(p.x, p.y);
  }
  const saved = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname.endsWith(`/projects/${pid}/map-measurements`) &&
      r.request().method() === "POST",
  );
  await page.keyboard.press("Enter");
  expect((await saved).status()).toBe(201);
  await expect(page.getByTestId("map-inspector").getByRole("region", { name: "Length" })).toContainText(
    /50\.0[0-4] m/,
  );
});
