import { test, expect, type Page } from "@playwright/test";
import { CRACK, djiFrames, P, serveImages, type World } from "./images/world";
import { openImage, toScreen, ws } from "./images/ui";

const posts = (world: World, tail: string) =>
  world.requests
    .filter((r) => r.method === "POST" && r.path.endsWith(tail))
    .map((r) => r.body as Record<string, unknown>);

async function chooseCrack(page: Page) {
  await page.keyboard.press("t");
  // The hotkey picks only a type the picker lists: under load the project's types can land after
  // T, and "c" then goes into the empty filter.
  await expect(ws(page).typePicker.getByRole("option", { name: new RegExp(CRACK.name) })).toBeVisible();
  await page.keyboard.press(CRACK.hotkey as string); // "c"
  await expect(ws(page).typePicker).toBeHidden();
}

async function drag(page: Page, a: [number, number], b: [number, number]) {
  const p = await toScreen(page, ...a);
  const q = await toScreen(page, ...b);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(q.x, q.y, { steps: 8 });
  await page.mouse.up();
}

async function click(page: Page, ix: number, iy: number) {
  const p = await toScreen(page, ix, iy);
  await page.mouse.click(p.x, p.y);
}

// Spec §17 flow 2, §1 done-means 2, §18 item 2.
test("box, rbox, polygon and point persist across a reload, 3 grades, undo covers them, Findings lists them", async ({
  page,
}) => {
  const frames = djiFrames();
  const world = await serveImages(page, { frames });
  await openImage(page, P, frames[0].id, "800x600");
  const w = ws(page);
  await chooseCrack(page);

  // Box, then grade it with 3 while its finding is in the inspector.
  // (x shifted right of the brief's [100,100]: the floating tool-palette overlays image x < ~110
  // at this fit scale and swallows the mousedown there — see the task report.)
  await page.keyboard.press("b");
  await drag(page, [150, 100], [230, 160]);
  await expect.poll(() => posts(world, "/boxes").length).toBe(1);
  expect(posts(world, "/boxes")[0]).toMatchObject({ class_id: CRACK.id });
  await expect(w.severity).toBeVisible();
  await page.keyboard.press("3");
  await expect(w.severity.getByRole("radio", { name: "3 Major" })).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => world.findings[0]?.severity).toBe(3);

  // Three-point rotated box: drag an edge A->B, release, move across for the width, click.
  await page.keyboard.press("Escape");
  await page.keyboard.press("r");
  await drag(page, [300, 120], [420, 190]);
  const across = await toScreen(page, 395, 235);
  await page.mouse.move(across.x, across.y, { steps: 5 });
  await page.mouse.click(across.x, across.y);
  await expect.poll(() => posts(world, "/boxes").length).toBe(2);
  expect(posts(world, "/boxes")[1]).toMatchObject({ shape: "rbox" });
  expect(Math.abs(posts(world, "/boxes")[1].angle as number)).toBeGreaterThan(1);

  // Polygon: four clicks, Enter. Shifted +100 (vs. the box's +50 above) for the same reason: both
  // offsets land past the tool-palette's right edge (image-x ≈106 at this fit scale), so either is
  // enough to clear it.
  await page.keyboard.press("Escape");
  await page.keyboard.press("p");
  for (const [x, y] of [
    [200, 300],
    [300, 300],
    [320, 380],
    [220, 400],
  ] as const)
    await click(page, x, y);
  await page.keyboard.press("Enter");
  await expect.poll(() => posts(world, "/boxes").length).toBe(3);
  expect(posts(world, "/boxes")[2]).toMatchObject({ shape: "polygon" });
  expect((posts(world, "/boxes")[2].points as unknown[]).length).toBe(4);

  // Point marker, then undo and redo it.
  await page.keyboard.press("Escape");
  await page.keyboard.press("m");
  await click(page, 600, 400);
  await expect.poll(() => posts(world, "/boxes").length).toBe(4);
  expect(posts(world, "/boxes")[3]).toMatchObject({ shape: "point" });
  await page.keyboard.press("Control+z");
  await expect.poll(() => world.requests.filter((r) => r.method === "DELETE").length).toBe(1);
  await page.keyboard.press("Control+y");
  await expect.poll(() => posts(world, "/boxes").length).toBe(5);

  // Saved, then reload: everything is still there (Review Focus 3).
  await expect(w.saveState).toContainText("Saved");
  expect(world.boxes.get(frames[0].id)!.length).toBe(4);
  await page.reload();
  await expect(w.canvas).toHaveAttribute("data-image", "800x600");
  await expect(w.canvas).toHaveAttribute("data-shape-count", "4");

  // Findings in the sidebar lists the four findings, the graded one as Major.
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: /^Findings/ }).click();
  await expect(page.getByRole("row", { name: /F-\d{4}/ })).toHaveCount(4);
  await expect(page.getByRole("row", { name: /F-0001/ })).toContainText("Major");
});

// Review Focus 2: keys typed into a text field never reach the tools (F's isTypingTarget).
test("typing in the note does not switch tools", async ({ page }) => {
  const frames = djiFrames();
  const world = await serveImages(page, { frames });
  await openImage(page, P, frames[0].id, "800x600");
  await chooseCrack(page);
  await page.keyboard.press("b");
  await drag(page, [150, 100], [230, 160]);
  await expect.poll(() => world.findings.length).toBe(1);
  const w = ws(page);
  await expect(w.canvas).toHaveAttribute("data-tool", "box");
  await w.note.click();
  await page.keyboard.type("bp spall");
  await expect(w.canvas).toHaveAttribute("data-tool", "box");
  await expect(w.note).toHaveValue(/bp spall/);
});
