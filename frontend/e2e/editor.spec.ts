import { test, expect, type Page } from "@playwright/test";

export const P = "7f1c2e3a-1111-4000-8000-000000000001";
export const IMG = "10000000-5555-4000-8000-000000000001";

export async function openEditor(page: Page) {
  await page.goto(`/p/${P}/edit/${IMG}`);
  const canvas = page.getByTestId("editor-canvas");
  await expect(canvas).toHaveAttribute("data-image", "4000x2667", { timeout: 15_000 });
  return canvas;
}

export async function readView(page: Page) {
  const canvas = page.getByTestId("editor-canvas");
  return {
    scale: Number(await canvas.getAttribute("data-view-scale")),
    x: Number(await canvas.getAttribute("data-view-x")),
    y: Number(await canvas.getAttribute("data-view-y")),
  };
}

/** Display coordinates (page pixels) of an image-pixel point. */
export async function displayPoint(page: Page, ix: number, iy: number) {
  const box = await page.getByTestId("editor-canvas").boundingBox();
  if (!box) throw new Error("canvas not laid out");
  const v = await readView(page);
  return { x: box.x + ix * v.scale + v.x, y: box.y + iy * v.scale + v.y };
}

test("loads the image record and boxes, fits the image and zooms with the wheel", async ({ page }) => {
  const boxesRequest = page.waitForRequest((r) => r.method() === "GET" && r.url().endsWith(`/images/${IMG}/boxes`));
  const canvas = await openEditor(page);
  await boxesRequest;
  const fitted = await readView(page);
  expect(fitted.scale).toBeGreaterThan(0.1);
  expect(fitted.scale).toBeLessThan(1);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -240);
  await expect.poll(async () => (await readView(page)).scale).toBeGreaterThan(fitted.scale);
});

test("pans with space-drag", async ({ page }) => {
  const canvas = await openEditor(page);
  const before = await readView(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas box");
  await page.keyboard.down(" ");
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 230, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up(" ");
  await expect.poll(async () => (await readView(page)).x).toBeCloseTo(before.x + 60, 0);
  expect((await readView(page)).scale).toBe(before.scale);
});

test("drawing on the canvas posts a box in image pixels with the active class", async ({ page }) => {
  await openEditor(page);
  const from = await displayPoint(page, 2000, 1500);
  const to = await displayPoint(page, 2400, 1800);
  const posted = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith(`/images/${IMG}/boxes`));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  const body = (await posted).postDataJSON() as { class_id: string; x: number; y: number; w: number; h: number };
  const { scale } = await readView(page);
  const tolerance = 2 / scale + 1;
  expect(body.class_id).toBe("c1a2b3c4-0000-4000-8000-000000000001");
  expect(Math.abs(body.x - 2000)).toBeLessThan(tolerance);
  expect(Math.abs(body.y - 1500)).toBeLessThan(tolerance);
  expect(Math.abs(body.w - 400)).toBeLessThan(tolerance);
  expect(Math.abs(body.h - 300)).toBeLessThan(tolerance);
});

test("dragging a box patches its position", async ({ page }) => {
  await openEditor(page);
  const centre = await displayPoint(page, 512 + 70, 300 + 45);
  const patched = page.waitForRequest(
    (r) => r.method() === "PATCH" && r.url().includes("/boxes/b0000000-6666-4000-8000-000000000001"),
  );
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 40, centre.y + 20, { steps: 8 });
  await page.mouse.up();
  const body = (await patched).postDataJSON() as { x: number; y: number; w: number; h: number };
  const { scale } = await readView(page);
  expect(Math.abs(body.x - (512 + 40 / scale))).toBeLessThan(2 / scale + 1);
  expect(Math.abs(body.y - (300 + 20 / scale))).toBeLessThan(2 / scale + 1);
  expect(body.w).toBeCloseTo(140, 0);
  expect(body.h).toBeCloseTo(90, 0);
});

test("class hotkeys, fit and 1:1 keys, region list selection, Delete and Ctrl+D", async ({ page }) => {
  await openEditor(page);
  const fitted = await readView(page);
  await page.keyboard.press("4");
  await expect(page.getByRole("button", { name: /dump_truck/ })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("0");
  await expect(page.getByTestId("editor-canvas")).toHaveAttribute("data-view-scale", "1.0000");
  await page.keyboard.press("f");
  await expect(page.getByTestId("editor-canvas")).toHaveAttribute("data-view-scale", fitted.scale.toFixed(4));

  const excavatorRow = page.getByRole("listitem").filter({ hasText: "Person" });
  await excavatorRow.click();
  await expect(excavatorRow).toHaveAttribute("aria-selected", "true");

  const duplicated = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith(`/images/${IMG}/boxes`));
  await page.keyboard.press("Control+d");
  const dupBody = (await duplicated).postDataJSON() as { x: number; y: number; w: number; h: number };
  expect(dupBody).toEqual({ class_id: "c1a2b3c4-0000-4000-8000-000000000001", x: 524, y: 312, w: 140, h: 90 });

  await excavatorRow.click();
  const deleted = page.waitForRequest(
    (r) => r.method() === "DELETE" && r.url().includes("/boxes/b0000000-6666-4000-8000-000000000001"),
  );
  await page.keyboard.press("Delete");
  await deleted;
  await expect(page.getByRole("status").filter({ hasText: /Saved/ })).toBeVisible();
});

test("a class hotkey with a selected box reclassifies it", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("listitem").filter({ hasText: "Person" }).click();
  const patched = page.waitForRequest(
    (r) => r.method() === "PATCH" && r.url().includes("/boxes/b0000000-6666-4000-8000-000000000001"),
  );
  await page.keyboard.press("3");
  expect((await patched).postDataJSON()).toEqual({ class_id: "c1a2b3c4-0000-4000-8000-000000000003" });
});

const PROPOSAL = "b0000000-6666-4000-8000-000000000002";

test("A accepts all visible proposals and R rejects them through the review endpoint", async ({ page }) => {
  await openEditor(page);
  await expect(page.getByTestId("proposal-count")).toHaveText("1 proposal");
  const accepted = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/boxes/review"));
  await page.keyboard.press("a");
  expect((await accepted).postDataJSON()).toEqual({ box_ids: [PROPOSAL], action: "accept" });
  await expect(page.getByTestId("proposal-count")).toHaveText("0 proposals");
  await expect(page.getByRole("button", { name: "Accept all (A)" })).toBeDisabled();
});

test("R rejects, Show rejected reveals the row, and the region list accepts one proposal", async ({ page }) => {
  await openEditor(page);
  const rejected = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/boxes/review"));
  await page.keyboard.press("r");
  expect((await rejected).postDataJSON()).toEqual({ box_ids: [PROPOSAL], action: "reject" });
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await page.getByRole("button", { name: "Show rejected" }).click();
  await expect(page.getByRole("listitem")).toHaveCount(2);
  await expect(page.getByRole("listitem").nth(1)).toContainText("Rejected");

  await openEditor(page);
  const one = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/boxes/review"));
  await page.getByRole("button", { name: "Accept box 2" }).click();
  expect((await one).postDataJSON()).toEqual({ box_ids: [PROPOSAL], action: "accept" });
});

test("pre-annotates on open when no proposal is pending and tolerates 501", async ({ page }) => {
  await page.route(`**/api/v1/projects/${P}/images/${IMG}/boxes`, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({
            items: [
              {
                id: "b0000000-6666-4000-8000-000000000001",
                image_id: IMG,
                class_id: "c1a2b3c4-0000-4000-8000-000000000001",
                x: 512,
                y: 300,
                w: 140,
                h: 90,
                confidence: null,
                provenance: { kind: "person", model_id: null, provider: null, model_name: null, query_run_id: null },
                review_state: "accepted",
                reviewed_at: "2026-09-17T10:45:00Z",
                created_at: "2026-09-17T10:45:00Z",
              },
            ],
          }),
        })
      : route.continue(),
  );
  const preannotate = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith(`/images/${IMG}/preannotate`),
  );
  await openEditor(page);
  await preannotate;
  await expect(page.getByTestId("proposal-count")).toHaveText("1 proposal");
  await expect(
    page.getByRole("status").filter({ hasText: "1 proposal from the pre-annotation model" }),
  ).toBeVisible();

  await page.route(`**/api/v1/projects/${P}/images/${IMG}/preannotate`, (route) =>
    route.fulfill({
      status: 501,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        error: { code: "not_implemented", message: "pre-annotation arrives with S4", details: {} },
      }),
    }),
  );
  await openEditor(page);
  await expect(page.getByRole("status").filter({ hasText: "Pre-annotation is not available yet" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
