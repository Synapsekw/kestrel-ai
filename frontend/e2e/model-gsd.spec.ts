import { test, expect } from "@playwright/test";
import { evidencePath } from "./evidence";
import { asDetectionProject, fromMock, jsonReply } from "./kinds";

// The contract's examples: the detection project and its map source.
const P = "7f1c2e3a-1111-4000-8000-000000000001";
const MAP_SOURCE = "50000000-3333-4000-8000-000000000002";
const MODEL = "m0000000-2222-4000-8000-000000000001";

// The scale a model trained on senseFly Aeria X imagery flown at ~191 m is actually derived at:
// the real numbers from the backend's gsd-estimate test, not invented ones (spec section 3).
const gsdEstimate = {
  train_gsd_cm: 18.92,
  image_gsd_cm: 6.055,
  median_alt_m: 191.02,
  focal_mm: 18.5,
  sensor_width_mm: 23.456,
  sensor_source: "focal_plane",
  sample_size: 8,
  imgsz: 1280,
  median_object_m: 8.39,
  per_class_m: { excavator: 8.39, dump_truck: 8.9, roller: 5.07 },
  plausible: true,
};

test.beforeEach(({ page }) => asDetectionProject(page, P));

/**
 * The reported failure, end to end: `ICVD_V4` had no stored training scale, and the dialog let the
 * run start anyway. The map was then read at its own 2.296 cm/px - about 7x finer than the model
 * had ever seen - and the run found three objects about 1.5 m across on a site whose dump trucks
 * are 8.9 m. Now the dialog derives the scale, shows the evidence, and refuses to start without one.
 */
test("a model with no training scale offers its derived one, with the evidence for it", async ({
  page,
}) => {
  const example = await fromMock(page, `/api/v1/library/models/${MODEL}`);
  // ICVD_V4 as it really was: trained, with a dataset in its provenance, and no scale recorded.
  const model: Record<string, unknown> = { ...example, name: "ICVD_V4", train_gsd_cm: null };
  await page.route(
    (u) => u.pathname === "/api/v1/library/models",
    (route) =>
      route.request().method() === "GET"
        ? route.fulfill(jsonReply({ items: [model], next_cursor: null }))
        : route.fallback(),
  );
  await page.route(
    (u) => u.pathname.endsWith(`/library/models/${MODEL}/gsd-estimate`),
    (route) => route.fulfill(jsonReply(gsdEstimate)),
  );
  const patched = page.waitForRequest(
    (r) => r.method() === "PATCH" && r.url().endsWith(`/library/models/${MODEL}`),
  );
  await page.route(
    (u) => u.pathname === `/api/v1/library/models/${MODEL}`,
    (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill(jsonReply({ ...model, train_gsd_cm: gsdEstimate.train_gsd_cm }))
        : route.fallback(),
  );

  await page.goto(`/p/${P}/runs?source=${MAP_SOURCE}`);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("checkbox", { name: "May survey" })).toBeChecked();

  const offer = dialog.getByText(/This model was trained at about/);
  await expect(offer).toContainText("trained at about 18.92 cm / px");
  await expect(offer).toContainText("flown at about 191.02 m");
  await expect(offer).toContainText("machines about 8.39 m across");

  // The scale is still unknown at this exact moment, so the run's central guarantee has to hold
  // right here: Start is disabled and the field says what the number is for.
  const field = dialog.getByLabel("Model trained at (cm / px)");
  await expect(field).toHaveValue("");
  const start = dialog.getByRole("button", { name: "Start run" });
  await expect(start).toBeDisabled();
  await expect(dialog.getByText(/Set the scale this model was trained at/)).toBeVisible();

  await page.screenshot({
    path: evidencePath("model-gsd", "2026-09-23-scale-offer.png"),
    fullPage: true,
  });

  await dialog.getByRole("button", { name: "Use 18.92" }).click();
  await expect(field).toHaveValue("18.92");
  await expect(start).toBeEnabled();
  // Accepted once, remembered on the library model, so the next run does not ask again.
  expect((await patched).postDataJSON()).toEqual({ train_gsd_cm: 18.92 });
});
