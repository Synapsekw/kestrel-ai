import { expect, test, type Page } from "@playwright/test";
import { jsonReply } from "./mock";

const P = "7f1c2e3a-1111-4000-8000-000000000001";
const INSP = "e0000000-2222-4000-8000-000000000001";
const IJ = "j0000000-8888-4000-8000-000000000001";
const BJ = "j0000000-9999-4000-8000-000000000001";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaGhgAAAChACB8f3CzwAAAABJRU5ErkJggg==",
  "base64",
);
const job = (id: string, state: string, type = "drawing_import") => ({
  id,
  project_id: P,
  type,
  state,
  progress: state === "succeeded" ? 1 : 0,
  message: "",
  log_path: "",
  params: {},
  result: null,
  error: null,
  created_at: "2026-09-27T09:00:00Z",
  started_at: null,
  finished_at: null,
});
const inspection = {
  id: INSP,
  state: "ready",
  error: null,
  job_id: IJ,
  path: "D:\\plans\\foundation-plan.pdf",
  format: "pdf",
  file_size: 5242880,
  sha256: null,
  units: null,
  units_source: null,
  crs_hint: null,
  extent_src: null,
  layers: [],
  page_count: 2,
  pages: [
    { page: 1, width_pt: 2384, height_pt: 1684 },
    { page: 2, width_pt: 2384, height_pt: 1684 },
  ],
  width: null,
  height: null,
  embedded: null,
  warnings: [],
  created_at: "2026-09-27T09:00:00Z",
};

async function routes(page: Page) {
  await page.route(`**/api/v1/projects/${P}/drawing-inspections`, (r) =>
    r.fulfill(
      jsonReply(
        {
          inspection: { ...inspection, state: "inspecting", pages: [] },
          job: job(IJ, "queued"),
        },
        202,
      ),
    ),
  );
  await page.route(`**/api/v1/projects/${P}/drawing-inspections/${INSP}`, (r) =>
    r.fulfill(jsonReply(inspection)),
  );
  await page.route(`**/api/v1/projects/${P}/drawing-inspections/${INSP}/pages/*/thumbnail*`, (r) =>
    r.fulfill({
      status: 200,
      contentType: "image/png",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: PNG,
    }),
  );
  await page.route(`**/api/v1/projects/${P}/jobs/${IJ}`, (r) => r.fulfill(jsonReply(job(IJ, "succeeded"))));
  await page.route(`**/api/v1/projects/${P}/drawings`, (r) =>
    r.request().method() === "POST"
      ? r.fulfill(
          jsonReply(
            {
              drawing: {
                id: "d1",
                name: "foundation-plan · p2",
                status: "importing",
              },
              job: job(BJ, "queued"),
            },
            202,
          ),
        )
      : r.fallback(),
  );
     await page.route(`**/api/v1/projects/${P}/drawings/pages`, (r) =>
       r.fulfill(
         jsonReply(
           {
             drawings: [
               { id: "d1", name: "foundation-plan · p1", status: "importing" },
               { id: "d2", name: "foundation-plan · p2", status: "importing" },
             ],
             job: job(BJ, "queued"),
           },
           202,
         ),
       ),
     );
   
  await page.route(`**/api/v1/projects/${P}/elevations`, (r) =>
    r.fulfill(
      jsonReply(
        {
          surface: {
            id: "s1",
            name: "sep-dsm",
            kind: "dem",
            status: "building",
          },
          job: job("jd", "queued", "elevation_import"),
        },
        202,
      ),
    ),
  );
}

test("Add data → Drawing imports page 2 of a PDF in the background", async ({ page }) => {
  await routes(page);
  await page.goto(`/p/${P}/overview`);
  await page.getByRole("button", { name: "Add data" }).first().click();
  await page
    .getByRole("dialog", { name: "Add data" })
    .getByRole("button", { name: /Drawing/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "Import drawing" });
  await dialog.getByLabel("Drawing file").fill("D:\\plans\\foundation-plan.pdf");
  await dialog.getByRole("button", { name: "Read file" }).click();
  await dialog.getByRole("checkbox", { name: "Page 1" }).click();
  await dialog.getByRole("radio", { name: "300 dpi" }).click();
  const post = page.waitForRequest(
    (r) => r.url().endsWith(`/projects/${P}/drawings`) && r.method() === "POST",
  );
  await dialog.getByRole("button", { name: "Start import" }).click();
  expect((await post).postDataJSON()).toEqual({
    inspection_id: INSP,
    name: "foundation-plan · p2",
    page: 2,
    dpi: 300,
    placement: { method: "none" },
  });
  await expect(page.getByText(/Drawing import started/)).toBeVisible();
  await expect(dialog).toBeHidden();
});

test("Add data → Drawing imports every page of a PDF in one request", async ({ page }) => {
  await routes(page);
  await page.goto(`/p/${P}/overview`);
  await page.getByRole("button", { name: "Add data" }).first().click();
  await page.getByRole("dialog", { name: "Add data" }).getByRole("button", { name: /Drawing/ }).click();
  const dialog = page.getByRole("dialog", { name: "Import drawing" });
  await dialog.getByLabel("Drawing file").fill("D:\\plans\\foundation-plan.pdf");
  await dialog.getByRole("button", { name: "Read file" }).click();
  await expect(dialog.getByRole("checkbox", { name: "Page 2" })).toHaveAttribute("aria-checked", "true");
  const post = page.waitForRequest((r) => r.url().endsWith(`/projects/${P}/drawings/pages`) && r.method() === "POST");
  await dialog.getByRole("button", { name: "Start import" }).click();
  expect((await post).postDataJSON()).toEqual({
    inspection_id: INSP,
    name: "foundation-plan",
    pages: "all",
    dpi: 150,
    placement: { method: "none" },
  });
  await expect(page.getByText(/Drawing import started/)).toBeVisible();
  await expect(dialog).toBeHidden();
});

test("Add elevation → DSM / DTM GeoTIFF queues POST /elevations", async ({ page }) => {
  await routes(page);
  await page.goto(`/p/${P}/overview`);
  await page.getByRole("button", { name: "Add data" }).first().click();
  await page
    .getByRole("dialog", { name: "Add data" })
    .getByRole("button", { name: /Elevation/ })
    .click();
  await page.getByRole("button", { name: /DSM \/ DTM GeoTIFF/ }).click();
  const dialog = page.getByRole("dialog", { name: "Add elevation" });
  await dialog.getByLabel("GeoTIFF file").fill("D:\\surveys\\sep-dsm.tif");
  await dialog.getByRole("radio", { name: "DTM — bare ground" }).click();
  const post = page.waitForRequest((r) => r.url().endsWith(`/projects/${P}/elevations`));
  await dialog.getByRole("button", { name: "Start import" }).click();
  expect((await post).postDataJSON()).toMatchObject({
    path: "D:\\surveys\\sep-dsm.tif",
    name: "sep-dsm",
    role: "dtm",
  });
  await expect(page.getByText(/Elevation import started/)).toBeVisible();
});
