import { test, expect, type Page } from "@playwright/test";
import { camerasJson, NADIR, PLAIN, routeCameras, routeImageRow } from "./fixtures/cameras";
import { CLOUD, cloudJson, jsonRoute } from "./fixtures/clouds";
import { buildOctree, redGreenGrid, routeOctree } from "./fixtures/potreeOctree";

const P = "7f1c2e3a-1111-4000-8000-000000000001";

// SwiftShader for WebGL only (vault/decisions/2026-09-26-gotcha-swiftshader-compositing.md).
test.use({ launchOptions: { args: ["--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"] } });

type Glyph = { imageId: string; x: number; y: number };
type Cams = { glyphs(): Glyph[]; lookingThrough(): boolean };
type Diag = { stats(): { settledMs: number | null; nodesLoading: number }; overlays(): string[] };
const cams = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __kestrelCloudCameras?: Cams }).__kestrelCloudCameras?.glyphs() ?? [],
  );
const looking = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __kestrelCloudCameras?: Cams }).__kestrelCloudCameras?.lookingThrough() ??
      false,
  );
const overlays = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __kestrelCloudViewer?: Diag }).__kestrelCloudViewer?.overlays() ?? [],
  );

async function settled(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { __kestrelCloudViewer?: Diag }).__kestrelCloudViewer?.stats().settledMs ??
            null,
        ),
      { timeout: 20_000 },
    )
    .not.toBeNull();
}

async function open(page: Page, query = "", cameras: { body?: unknown; status?: number } = {}) {
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds`, { items: [cloudJson()] });
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds/${CLOUD}`, cloudJson());
  await routeCameras(page, P, cameras.body ?? camerasJson(), cameras.status ?? 200);
  await routeImageRow(page, P, NADIR, "DJI_0712.JPG");
  await routeImageRow(page, P, PLAIN, "DJI_0713.JPG");
  await routeOctree(
    page,
    CLOUD,
    buildOctree(redGreenGrid({ origin: [243500, 3178000, 0], size: 100, step: 1 })),
  );
  await page.goto(`/p/${P}/clouds/${CLOUD}${query}`);
  await settled(page);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("kestrel.diagnostics", "1"));
});

test("cameras: the switch shows the glyphs, a glyph opens its popover, Look through frames the photo", async ({
  page,
}) => {
  await open(page);
  const row = page.getByTestId("cameras-row");
  await expect(row.getByText("2 photos · 1 with angles")).toBeVisible();
  await expect(row.getByText("3 photos without GPS")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Show camera positions" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect.poll(() => overlays(page)).toContain("cameras");

  await expect.poll(async () => (await cams(page)).some((g) => g.imageId === NADIR)).toBe(true);
  const g = (await cams(page)).find((c) => c.imageId === NADIR)!;
  await page.mouse.click(g.x, g.y);
  const popover = page.getByRole("dialog", { name: "Drone photo" });
  await expect(popover).toContainText("DJI_0712.JPG");

  await popover.getByRole("button", { name: "Look through" }).click();
  await expect(page.getByTestId("look-through-frame")).toBeVisible();
  expect(await looking(page)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("look-through-frame")).toHaveCount(0);
  expect(await looking(page)).toBe(false);

  // a view command and a wheel leave the photo pose in the engine: the frame and the pill go too
  const lookThroughNadir = async () => {
    // the glyph's spot once the view has stopped moving (a view command tweens for 350 ms)
    let last = "";
    await expect
      .poll(async () => {
        const c = (await cams(page)).find((x) => x.imageId === NADIR);
        const now = c ? `${Math.round(c.x)},${Math.round(c.y)}` : "";
        const stable = now !== "" && now === last;
        last = now;
        return stable;
      })
      .toBe(true);
    const [x, y] = last.split(",").map(Number);
    await page.mouse.click(x, y);
    await page
      .getByRole("dialog", { name: "Drone photo" })
      .getByRole("button", { name: "Look through" })
      .click();
    await expect(page.getByTestId("look-through-frame")).toBeVisible();
    expect(await looking(page)).toBe(true);
  };
  await lookThroughNadir();
  await page.getByRole("button", { name: "Top", exact: true }).click();
  await expect(page.getByTestId("look-through-frame")).toHaveCount(0);
  expect(await looking(page)).toBe(false);

  await lookThroughNadir();
  const box = (await page.getByTestId("cloud-canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -200);
  await expect(page.getByTestId("look-through-frame")).toHaveCount(0);
  await expect(page.getByText("Looking through the drone photo · Esc goes back")).toHaveCount(0);
  expect(await looking(page)).toBe(false);

  await page.getByRole("switch", { name: "Show camera positions" }).click();
  await expect.poll(() => overlays(page)).not.toContain("cameras");
});

test("cameras: the offset row does not push the cloud panel into a horizontal scrollbar (acceptance criterion 1)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1480, height: 900 });
  await open(page); // camerasJson() has one source ("Flight 14 Sep"), so its OffsetRow renders
  const panel = page.getByTestId("cloud-panel");
  await expect(panel.getByRole("group", { name: /Height offset/ })).toBeVisible();
  const overflow = await panel.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("cameras: a cloud without a CRS disables the switch with the reason", async ({ page }) => {
  await open(page, "", {
    status: 409,
    body: { error: { code: "needs_coordinates", message: "assign a CRS first", details: {} } },
  });
  await expect(page.getByRole("switch", { name: "Show camera positions" })).toBeDisabled();
  await expect(page.getByText("Assign a CRS to place the drone photos")).toBeVisible();
});

test("photo link: I, a pick, the list, and a click opens the image at the spot", async ({ page }) => {
  await open(page);
  await page.keyboard.press("i");
  const canvas = await page.getByTestId("cloud-canvas").boundingBox();
  await page.mouse.click(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);
  const list = page.getByRole("list", { name: "Photos that saw this point" });
  await expect(list).toBeVisible();
  await expect(list.getByRole("listitem").first()).toContainText("In frame");
  await expect(page.getByText(/2 photos saw this point · DJI_0712\.JPG closest/)).toBeVisible();
  // I-FW is not on `main` (controller adaptation 3), so only the jump's own URL is asserted here; race
  // the wait with the click since the (not-yet-built) image screen may rewrite the URL after it lands.
  const urlRe = new RegExp(`/p/${P}/images/${NADIR}\\?at=[\\d.]+,[\\d.]+&r=\\d+&from=cloud(:|%3A)${CLOUD}`);
  await Promise.all([page.waitForURL(urlRe), list.getByRole("button").first().click()]);
  await expect(page).toHaveURL(urlRe);
});

test("arrival from a posed photo pixel looks through the drone and marks the hit", async ({ page }) => {
  await open(page, `?from_image=${NADIR}&px=1024,768`);
  await expect.poll(() => overlays(page), { timeout: 20_000 }).toContain("from-image");
});

test("arrival from a position-only photo falls back to where the drone was", async ({ page }) => {
  await open(page, `?from_image=${PLAIN}&px=10,10`);
  await expect(page.getByText("Camera angles unknown: showing where the drone was")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/clouds/${CLOUD}\\?at=243560\\.000,3178050\\.000$`));
});

test("arrival from a photo that is not near the cloud says so", async ({ page }) => {
  await open(page, "?from_image=img-elsewhere&px=10,10");
  await expect(page.getByText("This spot is outside the cloud")).toBeVisible();
});
