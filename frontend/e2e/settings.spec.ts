import { test, expect } from "@playwright/test";
import { evidencePath } from "./evidence";

const P = "7f1c2e3a-1111-4000-8000-000000000001";
const CLASS1 = "c1a2b3c4-0000-4000-8000-000000000001";
const CLASS4 = "c1a2b3c4-0000-4000-8000-000000000004";
const MODEL = "m0000000-2222-4000-8000-000000000001";

test("renames and rehotkeys a class and saves the full list with PUT", async ({ page }) => {
  await page.goto(`/p/${P}/settings`);
  await expect(page.getByRole("heading", { name: "Project settings" })).toBeVisible();
  await page.getByLabel("Name of class 1").fill("digger");
  await page.getByLabel("Hotkey of class 1").selectOption("9");
  const put = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith(`/projects/${P}/classes`));
  await page.getByRole("button", { name: "Save classes" }).click();
  const body = (await put).postDataJSON() as Array<{
    id?: string;
    name: string;
    colour: string;
    hotkey: string | null;
  }>;
  expect(body).toHaveLength(8);
  expect(body[0]).toEqual({ id: CLASS1, name: "digger", colour: "#f97316", hotkey: "9" });
  await expect(page.getByRole("status").filter({ hasText: "Classes saved" })).toBeVisible();
});

test("removing a class that still has boxes is refused with an explanation", async ({ page }) => {
  await page.route(`**/api/v1/projects/${P}/classes`, (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 409,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({
            error: {
              code: "class_in_use",
              message: "class still has boxes",
              details: { class_id: CLASS4, box_count: 40 },
            },
          }),
        })
      : route.continue(),
  );
  await page.goto(`/p/${P}/settings`);
  await page.getByRole("button", { name: "Remove class 4" }).click();
  await expect(page.getByLabel("Name of class 8")).toHaveCount(0);
  await page.getByRole("button", { name: "Save classes" }).click();
  await expect(page.getByRole("alert")).toContainText(
    'Class "dump_truck" still has 40 boxes. Reassign or delete those boxes in the editor before removing it.',
  );
  await expect(page.getByLabel("Name of class 4")).toHaveValue("dump_truck");
});

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

  await page.route(`**/api/v1/projects/${P}/models*`, (route) =>
    route.fulfill({
      status: 501,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        error: { code: "not_implemented", message: "models arrive with S3", details: {} },
      }),
    }),
  );
  await page.reload();
  await expect(page.getByRole("note")).toContainText("The model registry is not available yet");
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

test("class-name fields keep their width beside the narrow hotkey select", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/p/${P}/settings`);
  const name = await page.getByLabel("Name of class 1").boundingBox();
  const hotkey = await page.getByLabel("Hotkey of class 1").boundingBox();
  // The hotkey select is sized 4.5rem (72 px); before the fix it took the whole row.
  expect(hotkey!.width).toBeLessThan(80);
  expect(name!.width).toBeGreaterThan(hotkey!.width * 3);
  await page.screenshot({ path: evidencePath("cleanup-a", "settings-classes.png") });
});
