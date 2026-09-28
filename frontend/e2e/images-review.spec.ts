import { test, expect } from "@playwright/test";
import { CRACK, djiFrames, EXCAVATOR, MODEL, P, serveImages, suggestion } from "./images/world";
import { openImage, ws } from "./images/ui";

// Spec §17 flow 3, §1 done-means 3 ("three keystrokes from suggestion to graded finding"), §18 item 3.
test("D runs the model, A accepts, 3 grades, X rejects, and Tab moves to the next image with suggestions", async ({
  page,
}) => {
  const [one, two, three] = djiFrames();
  const world = await serveImages(page, {
    frames: [one, two, three],
    // Image 3 already has a pending suggestion: it is the next image in the review queue (flag 2).
    boxes: {
      [three.id]: [
        suggestion(three.id, "s-pending-3", CRACK.id, 0.8, {
          shape: "box",
          x: 50,
          y: 50,
          w: 60,
          h: 40,
          area_px: 2400,
        }),
      ],
    },
    detect: (f) => [
      suggestion(f.id, "s-crack", CRACK.id, 0.91, {
        shape: "box",
        x: 200,
        y: 200,
        w: 90,
        h: 50,
        area_px: 4500,
      }),
      suggestion(f.id, "s-excavator", EXCAVATOR.id, 0.62, {
        shape: "box",
        x: 500,
        y: 300,
        w: 120,
        h: 80,
        area_px: 9600,
      }),
    ],
  });
  await openImage(page, P, one.id, "800x600");
  const w = ws(page);

  await page.keyboard.press("d");
  await expect(w.modelMenu).toBeVisible();
  await expect(w.modelMenu).toContainText("Crack-seg v4");
  await page.keyboard.press("d");
  await expect.poll(() => world.requests.filter((r) => r.path.endsWith("/detect")).length).toBe(1);
  expect(world.requests.find((r) => r.path.endsWith("/detect"))!.body).toMatchObject({ model_id: MODEL });
  await expect(w.hintBar).toContainText(/2 AI suggestions on this image/);

  // A accepts the top suggestion (the crack, 0.91): it becomes a finding and the inspector opens it.
  await page.keyboard.press("a");
  await expect.poll(() => world.findings.length).toBe(1);
  const review = world.requests.filter((r) => r.path.endsWith("/boxes/review"));
  expect(review[0].body).toEqual({ box_ids: ["s-crack"], action: "accept" });
  await expect(w.severity).toBeVisible();
  await page.keyboard.press("3");
  await expect.poll(() => world.findings[0].severity).toBe(3);

  // X rejects the remaining one (the excavator); the hint bar goes.
  await page.keyboard.press("x");
  await expect
    .poll(() => world.requests.filter((r) => r.path.endsWith("/boxes/review")).map((r) => r.body))
    .toContainEqual({ box_ids: ["s-excavator"], action: "reject" });
  await expect(w.hintBar).toBeHidden();
  expect(world.findings).toHaveLength(1); // the object was never a finding (D7)

  // Tab: no pending suggestion left here, so the next image with flag 2 (image 3, skipping 2).
  await page.keyboard.press("Tab");
  await expect(page).toHaveURL(new RegExp(`/images/${three.id}`));
  await expect(w.hintBar).toContainText(/1 AI suggestion/);
});
