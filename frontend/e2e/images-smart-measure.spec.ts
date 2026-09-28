import { test, expect } from "@playwright/test";
import { CRACK, djiFrames, P, serveImages } from "./images/world";
import { openImage, parseLengthMm, toScreen, ws } from "./images/ui";

// Spec §17 flow 4, §10 flow, §1 done-means 4.
test("S warms the embedding, a click segments, Enter creates a polygon drawn by SAM", async ({ page }) => {
  const frames = djiFrames();
  const world = await serveImages(page, { frames });
  await openImage(page, P, frames[0].id, "800x600");
  await page.keyboard.press("t");
  // The hotkey picks only a type the picker lists: under load the project's types can land after
  // T, and "c" (then "s") went into the empty filter instead.
  await expect(ws(page).typePicker.getByRole("option", { name: new RegExp(CRACK.name) })).toBeVisible();
  await page.keyboard.press(CRACK.hotkey as string);
  await expect(ws(page).typePicker).toBeHidden();

  // A click is ignored until `/segment/prepare` has answered and Enter needs the `/segment` answer
  // (ruling: wait on the responses, not on the world's logged request counts, which log before
  // replying).
  const prepared = page.waitForResponse((r) => r.url().endsWith("/segment/prepare"));
  await page.keyboard.press("s");
  await prepared;
  await expect.poll(() => world.requests.filter((r) => r.path.endsWith("/segment/prepare")).length).toBe(1);

  const at = await toScreen(page, 400, 300);
  const segmented = page.waitForResponse((r) => r.url().endsWith("/segment"));
  await page.mouse.click(at.x, at.y);
  await segmented;
  await expect.poll(() => world.requests.filter((r) => r.path.endsWith("/segment")).length).toBe(1);
  const prompt = world.requests.find((r) => r.path.endsWith("/segment"))!.body as {
    points: { x: number; y: number; positive: boolean }[];
  };
  expect(prompt.points).toHaveLength(1);
  expect(prompt.points[0].positive).toBe(true);
  expect(Math.abs(prompt.points[0].x - 400)).toBeLessThan(3);
  expect(Math.abs(prompt.points[0].y - 300)).toBeLessThan(3);

  await page.keyboard.press("Enter");
  await expect
    .poll(() => world.requests.filter((r) => r.method === "POST" && r.path.endsWith("/boxes")).length)
    .toBe(1);
  const created = world.requests.find((r) => r.method === "POST" && r.path.endsWith("/boxes"))!
    .body as Record<string, unknown>;
  expect(created).toMatchObject({ shape: "polygon", assist: "sam", class_id: CRACK.id });
  expect((created.points as unknown[]).length).toBe(24);
  expect(world.findings).toHaveLength(1); // F's invariant: a defect polygon is a finding
});

// Spec §17 flow 5, §9.3, §18 item 5: the length shows in mm with its ± and is saved.
test("L measures a length in mm with its uncertainty and saves it", async ({ page }) => {
  const frames = djiFrames();
  const world = await serveImages(page, { frames });
  await openImage(page, P, frames[0].id, "800x600");
  const gsd = frames[0].camera.gsd_mm as number; // ≈ 69.12 (ruling E8)

  await page.keyboard.press("l");
  // x shifted right of the brief's [100,500]/[200,500]: the floating tool-palette overlays image
  // x < ~110 at this fit scale and swallows the click there (see the task report). Both points
  // shift by the same +150 so the measured length (100 image px) is unchanged from the brief.
  const a = await toScreen(page, 250, 500);
  const b = await toScreen(page, 350, 500);
  await page.mouse.click(a.x, a.y);
  await page.mouse.move(b.x, b.y, { steps: 4 });

  // The readout exists only while the L draft has its second point, and disappears once the
  // measurement saves and is left unselected (ruling): capture it here, after the move and before
  // the second (committing) click, then assert it against the length the app actually saved.
  const readout = ws(page).measureReadout;
  await expect(readout).toContainText("±");
  const readoutText = (await readout.textContent()) ?? "";
  // The distance behind the mm is always shown (spec §9.3: "from GSD … · ±… at 38.4 m", or "nadir approx.").
  await expect(readout).toContainText(/38\.4\s*m|nadir approx/i);

  await page.mouse.click(b.x, b.y);
  await expect.poll(() => world.requests.filter((r) => r.path.endsWith("/measurements")).length).toBe(1);
  const saved = world.requests.find((r) => r.path.endsWith("/measurements"))!.body as Record<string, number>;
  const px = Math.hypot(saved.x2 - saved.x1, saved.y2 - saved.y1);
  expect(Math.abs(px - 100)).toBeLessThan(3);
  const mm = parseLengthMm(readoutText);
  expect(Math.abs(mm - px * gsd) / (px * gsd)).toBeLessThan(0.02);
});
