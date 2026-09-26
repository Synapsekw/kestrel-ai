import { test, expect, type Page } from "@playwright/test";
import { asDetectionProject, fromMock, jsonReply } from "./kinds";
import { evidencePath } from "./evidence";

// The contract's Project example, which the Prism mock serves for every project id.
const P = "7f1c2e3a-1111-4000-8000-000000000001";

const TRAIN_STEPS = ["Images", "Label", "Datasets", "Train", "Review", "Export"];
const DETECT_STEPS = [
  "Sources",
  "Runs",
  "Review",
  "Analytics",
  "Export",
  "Site areas",
  "Point clouds",
  "Volumes",
];

/** The pipeline entries of the sidebar, by their leading label. */
async function expectSteps(page: Page, shown: string[], hidden: string[]) {
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  for (const step of shown)
    await expect(nav.getByRole("link", { name: new RegExp(`^${step}`) })).toBeVisible();
  for (const step of hidden)
    await expect(nav.getByRole("link", { name: new RegExp(`^${step}`) })).toHaveCount(0);
  // The library is app-wide: it is in the rail whatever the project's kind.
  await expect(nav.getByRole("link", { name: "Library", exact: true })).toBeVisible();
}

test("creating a detection project opens it with the detection steps", async ({ page }) => {
  await asDetectionProject(page, P);
  // The mock answers every create with its training example; this one answers as asked.
  const example = await fromMock(page, `/api/v1/projects/${P}`);
  await page.route(
    (url) => url.pathname === "/api/v1/projects",
    (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const asked = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill(
        jsonReply({ ...example, name: asked.name, folder: asked.folder, kind: asked.kind, classes: [] }, 201),
      );
    },
  );
  await page.goto("/");
  await page.getByRole("radio", { name: "Detection project" }).click();
  // A detection project takes its classes from the first model it runs: no class list to fill in.
  await expect(page.getByText("Edit the class list")).toHaveCount(0);
  await page.getByLabel("Name").fill("Ahmadia survey");
  await page.locator("#project-folder").fill("E:\\Projects\\Ahmadia-survey");
  const created = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/api/v1/projects"));
  await page.getByRole("button", { name: "Create project" }).click();
  expect((await created).postDataJSON()).toEqual({
    name: "Ahmadia survey",
    folder: "E:\\Projects\\Ahmadia-survey",
    kind: "detect",
    classes: [],
  });
  await expect(page).toHaveURL(new RegExp(`/p/${P}$`));
  await expectSteps(page, DETECT_STEPS, ["Images", "Label", "Datasets", "Train", "Past detections"]);
  await page.screenshot({
    path: evidencePath("model-library", "detection-project-sidebar.png"),
    fullPage: true,
  });
});

test("a training project shows the training steps, and a detection screen sends it Home", async ({
  page,
}) => {
  await page.goto(`/p/${P}`);
  await expectSteps(page, TRAIN_STEPS, [
    "Sources",
    "Runs",
    "Analytics",
    "Site areas",
    "Detect",
    "Maps",
    "Point clouds",
    "Volumes",
  ]);
  await page.screenshot({
    path: evidencePath("model-library", "training-project-sidebar.png"),
    fullPage: true,
  });
  // Detect belongs to detection projects; typing its address in a training project lands on Home.
  await page.goto(`/p/${P}/query`);
  await expect(page).toHaveURL(new RegExp(`/p/${P}$`));
});

test("the projects list filters by kind", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Ahmadia", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Detection", exact: true }).click();
  await expect(page.getByText("No detection projects in the list.")).toBeVisible();
  await page.getByRole("radio", { name: "Training", exact: true }).click();
  await expect(page.getByText("Ahmadia", { exact: true })).toBeVisible();
});
