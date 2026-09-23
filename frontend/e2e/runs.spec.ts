import { test, expect } from "@playwright/test";
import { asDetectionProject, jsonReply } from "./kinds";
import { evidencePath } from "./evidence";

// The contract's examples: two runs (a map and a photo batch), the library model `ahmadia-v1-n`.
const P = "7f1c2e3a-1111-4000-8000-000000000001";
const MODEL = "m0000000-2222-4000-8000-000000000001";
const MAP_SOURCE = "50000000-3333-4000-8000-000000000002";

test.beforeEach(({ page }) => asDetectionProject(page, P));

test("Runs lists what each run found and how far its review has got", async ({ page }) => {
  await page.goto(`/p/${P}/runs`);
  await expect(page.getByRole("heading", { name: "Runs", exact: true })).toBeVisible();
  const map = page.getByRole("row").filter({ hasText: "May survey" });
  await expect(map).toContainText("machinery-v3");
  await expect(map).toContainText("34 of 59 reviewed");
  const photos = page.getByRole("row").filter({ hasText: "Flight 15 Apr" });
  await expect(photos).toContainText("12 of 40 reviewed");
  await page.screenshot({ path: evidencePath("detection-workspace", "runs.png"), fullPage: true });
});

test("a new run whose model has classes the project lacks asks once, then starts", async ({ page }) => {
  // The first POST answers 422 unmapped_classes, as the backend does for a model the project has
  // no mapping for; after the mapping is saved, the same request goes through (the mock's 202).
  let posts = 0;
  const bodies: unknown[] = [];
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/runs`,
    (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      posts += 1;
      bodies.push(route.request().postDataJSON());
      if (posts > 1) return route.fallback();
      return route.fulfill(
        jsonReply(
          {
            error: {
              code: "unmapped_classes",
              message: "2 model classes have no project class",
              details: { model_id: MODEL, unmapped: ["crane", "car"] },
            },
          },
          422,
        ),
      );
    },
  );

  await page.goto(`/p/${P}/runs?source=${MAP_SOURCE}`);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("checkbox", { name: "May survey" })).toBeChecked();
  await dialog.getByRole("button", { name: "Start run" }).click();

  await expect(dialog.getByRole("heading", { name: "Match the model's classes" })).toBeVisible();
  await dialog.getByLabel("crane").selectOption({ label: "crane" });
  await dialog.getByLabel("car").selectOption({ label: "Ignore (do not keep these detections)" });
  await page.screenshot({
    path: evidencePath("detection-workspace", "runs-class-mapping.png"),
    fullPage: true,
  });
  const saved = page.waitForRequest(
    (r) => r.method() === "PUT" && r.url().endsWith(`/model-class-maps/${MODEL}`),
  );
  await dialog.getByRole("button", { name: "Save and start" }).click();
  expect((await saved).postDataJSON()).toEqual({
    mapping: { crane: "c1a2b3c4-0000-4000-8000-000000000005", car: null },
    new_classes: [],
  });

  // The retry is the same request, and this time the run starts.
  await expect(dialog).toBeHidden();
  expect(posts).toBe(2);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(bodies[0]).toMatchObject({ source_ids: [MAP_SOURCE], model_id: MODEL });
});
