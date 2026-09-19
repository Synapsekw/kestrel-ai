import { test, expect } from "@playwright/test";

const P = "7f1c2e3a-1111-4000-8000-000000000001";
const SOURCE = "50000000-3333-4000-8000-000000000001";
const JOB = "j0000000-4444-4000-8000-000000000001";
const FOLDER = "E:\\Dev\\Yolo\\Ahmadia Construction Data";
const REGEX = "^(?P<camera>[A-Za-z0-9-]+)_(?P<flight>\\d+)_(?P<frame>\\d+)";

test("Import images posts the folder with the project's defaults and shows the job in the panel", async ({
  page,
}) => {
  await page.goto(`/p/${P}/data`);
  await page.getByRole("button", { name: "Import images" }).click();
  const dialog = page.getByRole("dialog", { name: "Import images" });
  await expect(dialog.getByLabel("Max side")).toHaveValue("4000");
  await expect(dialog.getByLabel("JPEG quality")).toHaveValue("95");
  await expect(dialog.getByLabel("Duplicate threshold")).toHaveValue("4");
  await expect(dialog.getByLabel("Group regex")).toHaveValue(REGEX);
  await expect(dialog.getByRole("button", { name: "Browse" })).toHaveCount(0);
  await dialog.getByLabel("Folder").fill(FOLDER);
  await dialog.getByLabel("Site name").fill("ahmadia");
  await dialog.getByLabel("Max side").fill("3000");
  const posted = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith(`/projects/${P}/sources`),
  );
  await dialog.getByRole("button", { name: "Start import" }).click();
  expect((await posted).postDataJSON()).toEqual({
    folder: FOLDER,
    site: "ahmadia",
    settings: { max_side: 3000, quality: 95, dedupe_threshold: 4, group_regex: REGEX },
  });
  // The banner reports the import; the jobs panel stays closed until the operator opens it.
  await expect(page.getByTestId("import-notice")).toContainText("Importing");
  const panel = page.getByRole("dialog", { name: "Jobs" });
  await expect(panel).toBeHidden();
  await page.getByRole("button", { name: "1 active job" }).click();
  await expect(panel.getByTestId(`job-${JOB}`).getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "42",
  );
  await expect(page.getByRole("button", { name: "1 active job" })).toBeVisible();
});

test("Sources in settings list counts, load stats and re-import the same folder", async ({ page }) => {
  await page.goto(`/p/${P}/settings`);
  const section = page.getByTestId("sources-section");
  await expect(section).toContainText("ahmadia");
  await expect(section).toContainText("3299 images, 0 duplicates");
  const stats = page.waitForRequest((r) => r.url().endsWith(`/sources/${SOURCE}/stats`));
  await section.getByRole("button", { name: "Stats" }).click();
  await stats;
  await expect(section).toContainText("3269 unlabeled");
  await expect(section).toContainText("41 pending review");
  const reimport = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith(`/projects/${P}/sources`),
  );
  await section.getByRole("button", { name: "Re-import new files" }).click();
  expect((await reimport).postDataJSON()).toEqual({
    folder: FOLDER,
    site: "ahmadia",
    settings: { max_side: 4000, quality: 95, dedupe_threshold: 4, group_regex: REGEX },
  });
  await expect(page.getByRole("dialog", { name: "Jobs" })).toBeVisible();
});
