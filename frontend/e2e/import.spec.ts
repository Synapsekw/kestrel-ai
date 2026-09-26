import { test, expect } from "@playwright/test";
import { appJobsBody, fulfilJson } from "./fixtures/appSections";

const P = "7f1c2e3a-1111-4000-8000-000000000001";
const SOURCE = "50000000-3333-4000-8000-000000000001";
const FOLDER = "E:\\Dev\\Yolo\\Ahmadia Construction Data";
const REGEX = "^(?P<camera>[A-Za-z0-9-]+)_(?P<flight>\\d+)_(?P<frame>\\d+)";

test("Import images posts the folder with the project's defaults and shows the job in the Jobs section", async ({
  page,
}) => {
  await page.route(
    (url) => url.pathname === "/api/v1/jobs",
    (route) => fulfilJson(route, appJobsBody(route.request().url())),
  );
  await page.goto(`/p/${P}/images`);
  await page.getByRole("button", { name: "Import images" }).click();
  const dialog = page.getByRole("dialog", { name: "Import images" });
  await dialog.getByText("Advanced settings (the defaults suit most imports)").click();
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
  // The banner reports the import; the running pill leads to the Jobs section.
  await expect(page.getByTestId("import-notice")).toContainText("Importing");
  await page
    .getByRole("banner")
    .getByRole("link", { name: /^Importing/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/jobs\\?project=${P}$`));
  await expect(page.getByRole("row", { name: /Import/ }).getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "42",
  );
});

test("Sources in settings list counts, load stats and re-import the same folder into the Jobs section", async ({
  page,
}) => {
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
  await expect(page).toHaveURL(/\/jobs\?(state=\w+&)?job=/);
  await expect(page.getByRole("heading", { name: "Jobs", exact: true })).toBeVisible();
});
