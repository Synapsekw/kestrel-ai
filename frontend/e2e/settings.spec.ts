import { test, expect } from "@playwright/test";
import { CATALOGUE_PAGE, fulfilJson } from "./fixtures/appSections";
import { fromMock } from "./mock";

const P = "7f1c2e3a-1111-4000-8000-000000000001";
const MODEL = "m0000000-2222-4000-8000-000000000001";

test("pre-annotation model selection patches the project and tolerates a missing registry", async ({
  page,
}) => {
  await page.goto(`/p/${P}/settings`);
  const select = page.getByLabel("Pre-annotation model");
  await expect(select).toHaveValue(MODEL);
  await expect(select).toBeEnabled();
  const patched = page.waitForRequest((r) => r.method() === "PATCH" && r.url().endsWith(`/projects/${P}`));
  await select.selectOption("");
  expect((await patched).postDataJSON()).toEqual({ preannotation_model_id: null });

  await page.route(`**/api/v1/library/models*`, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        error: { code: "library_unavailable", message: "library.db is not a database", details: {} },
      }),
    }),
  );
  await page.reload();
  await expect(page.getByRole("note")).toContainText("The model library could not be opened");
  await expect(page.getByLabel("Pre-annotation model")).toBeDisabled();
});

test("import defaults save with PATCH and the provider placeholder is present", async ({ page }) => {
  await page.goto(`/p/${P}/settings`);
  await page.getByLabel("Max side").fill("3000");
  const patched = page.waitForRequest((r) => r.method() === "PATCH" && r.url().endsWith(`/projects/${P}`));
  await page.getByRole("button", { name: "Save import defaults" }).click();
  const body = (await patched).postDataJSON() as {
    import_defaults: { max_side: number; quality: number; dedupe_threshold: number; group_regex: string };
  };
  expect(body.import_defaults.max_side).toBe(3000);
  expect(body.import_defaults.quality).toBe(95);
  expect(body.import_defaults.dedupe_threshold).toBe(4);
  await expect(page.getByRole("heading", { name: "Provider keys" })).toBeVisible();
  await expect(page.getByText(/Windows Credential Manager/)).toBeVisible();
});

test("the project's type list adds a catalogue type and saves the order with PUT /types", async ({
  page,
}) => {
  await page.route(
    (url) => url.pathname === "/api/v1/catalogue/types",
    (route) => fulfilJson(route, CATALOGUE_PAGE),
  );
  // Read once and answered from memory (mock.ts's fromMock): a proxied route.fetch can meet a
  // keep-alive socket the mock just closed (ECONNRESET on a loaded CI runner).
  const project = await fromMock(page, `/api/v1/projects/${P}`);
  await page.route(`**/api/v1/projects/${P}`, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    project.classes = [
      {
        id: "t-1",
        name: "Excavator",
        colour: "#f97316",
        hotkey: "1",
        order: 0,
        kind: "object",
        default_severity: null,
        group: null,
      },
    ];
    return fulfilJson(route, project);
  });
  await page.route(`**/api/v1/projects/${P}/types`, (route) => fulfilJson(route, {}));
  await page.goto(`/p/${P}/settings`);
  await expect(page.getByRole("heading", { name: "Types" })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Add type").fill("dump");
  await page.getByRole("button", { name: "Add Dump truck" }).click();
  const put = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith(`/projects/${P}/types`));
  await page.getByRole("button", { name: "Save types" }).click();
  expect((await put).postDataJSON()).toEqual({
    type_ids: ["t-1", "t-2"],
    hotkeys: {},
  });
});
