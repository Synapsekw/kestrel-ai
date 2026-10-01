import { test, expect, type Page } from "@playwright/test";
import { entrancesDone, evidencePath } from "./evidence";
import { fromMock, jsonReply } from "./mock";

// The contract's Project example, which the Prism mock serves for every project id.
const P = "7f1c2e3a-1111-4000-8000-000000000001";

async function serveProjects(page: Page, items: unknown[]) {
  await page.route(
    (u) => u.pathname === "/api/v1/projects",
    (route) =>
      route.request().method() === "GET"
        ? route.fulfill(jsonReply({ items, next_cursor: null }))
        : route.fallback(),
  );
}

test("the projects list shows cards and creates a project without a kind", async ({ page }) => {
  const example = await fromMock(page, `/api/v1/projects/${P}`);
  await serveProjects(page, [{ ...example, migration: { state: "ok" } }]);
  await page.goto("/projects");
  await expect(page.getByRole("article").first()).toBeVisible();
  await expect(page.getByText("Training project")).toHaveCount(0);
  await entrancesDone(page);
  await page.screenshot({ path: evidencePath("foundation-s1", "projects-list.png"), fullPage: true });

  await page.getByRole("button", { name: "New project" }).click();
  await expect(page).toHaveURL(/\/projects\/new$/);
  await page.locator("#project-name").fill("Tower Q3");
  await page.locator("#project-folder").fill("E:\\Projects\\Tower-Q3");
  const created = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/api/v1/projects"));
  await page.getByRole("button", { name: "Create project" }).click();
  const body = (await created).postDataJSON() as Record<string, unknown>;
  expect(body).toMatchObject({ name: "Tower Q3", folder: "E:\\Projects\\Tower-Q3" });
  expect(Array.isArray(body.type_ids)).toBe(true);
  expect(body).not.toHaveProperty("kind");
  await expect(page).toHaveURL(new RegExp(`/p/${P}/overview$`));
});

test("a project that failed to upgrade offers Retry and Details and cannot be opened", async ({ page }) => {
  const example = await fromMock(page, `/api/v1/projects/${P}`);
  await serveProjects(page, [
    { ...example, id: "p-ok", name: "Healthy", migration: { state: "ok" } },
    {
      ...example,
      id: "p-bad",
      name: "Broken",
      summary: null,
      migration: {
        state: "failed",
        error: "step catalogue_merge: disk full",
        backup_path: "E:\\Projects\\Broken\\backups\\project.db.v1.bak",
      },
    },
  ]);
  await page.goto("/projects");
  const bad = page.getByRole("article", { name: "Broken" });
  await expect(bad.getByText("Couldn't upgrade")).toBeVisible();
  await expect(bad.getByRole("button", { name: "Open" })).toBeDisabled();
  await expect(
    page.getByRole("article", { name: "Healthy" }).getByRole("button", { name: "Open" }),
  ).toBeEnabled();
  await bad.getByRole("button", { name: "Details" }).click();
  await expect(page.getByRole("dialog", { name: "Broken could not be upgraded" })).toContainText("disk full");
  await entrancesDone(page);
  await page.screenshot({ path: evidencePath("foundation-s1", "projects-failed-upgrade.png") });
});

test("a project whose folder is gone offers Locate folder and Remove from list", async ({ page }) => {
  // Prism only serves the contract's example (availability "ok"); the list is served here with a
  // contract-shaped entry for a folder that no longer exists (summary null, availability "missing").
  const example = await fromMock(page, `/api/v1/projects/${P}`);
  await serveProjects(page, [
    { ...example, id: "p-gone", name: "Moved away", summary: null, availability: "missing" },
  ]);
  await page.goto("/projects");
  const gone = page.getByRole("article", { name: "Moved away" });
  await expect(gone.getByText("Folder not found")).toBeVisible();
  await expect(gone.getByRole("button", { name: "Open" })).toHaveCount(0);

  await gone.getByRole("button", { name: "Locate folder…" }).click();
  const locate = page.getByRole("dialog", { name: "Locate Moved away" });
  await expect(locate.getByRole("button", { name: "Use this folder" })).toBeVisible();
  await locate.getByRole("button", { name: "Cancel" }).click();
  await expect(locate).toHaveCount(0);

  await gone.getByRole("button", { name: "Remove from list" }).click();
  const confirm = page.getByRole("dialog", { name: "Remove Moved away from the list?" });
  const forgot = page.waitForRequest(
    (r) => r.method() === "DELETE" && r.url().endsWith("/api/v1/projects/p-gone"),
  );
  await confirm.getByRole("button", { name: "Remove from the list" }).click();
  await forgot;
  await expect(gone).toHaveCount(0);
});
