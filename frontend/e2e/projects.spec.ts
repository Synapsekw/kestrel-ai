import { test, expect } from "@playwright/test";
import { fromMock, jsonReply } from "./mock";

// The contract's Project example, which the Prism mock serves for every project id.
const P = "7f1c2e3a-1111-4000-8000-000000000001";

test("creating a project posts its name and folder and opens its Overview", async ({ page }) => {
  // The mock answers every create with its example; this one answers with the name and folder asked.
  const example = await fromMock(page, `/api/v1/projects/${P}`);
  await page.route(
    (url) => url.pathname === "/api/v1/projects",
    (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const asked = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill(jsonReply({ ...example, name: asked.name, folder: asked.folder }, 201));
    },
  );
  await page.goto("/");
  await page.getByLabel("Name").fill("Ahmadia survey");
  await page.locator("#project-folder").fill("E:\\Projects\\Ahmadia-survey");
  const created = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/api/v1/projects"));
  await page.getByRole("button", { name: "Create project" }).click();
  expect((await created).postDataJSON()).toEqual({
    name: "Ahmadia survey",
    folder: "E:\\Projects\\Ahmadia-survey",
    type_ids: [],
  });
  await expect(page).toHaveURL(new RegExp(`/p/${P}/overview$`));
  await expect(page.getByRole("tablist").getByRole("tab")).toHaveCount(7);
  await expect(page.getByRole("tablist")).toBeVisible();
});

test("the projects list has no kind", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Ahmadia", { exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Detection", exact: true })).toHaveCount(0);
  await expect(page.getByText("Training project")).toHaveCount(0);
});
