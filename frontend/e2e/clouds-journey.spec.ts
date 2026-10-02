import { test, expect, type Locator, type Page } from "@playwright/test";
import { CLOUD } from "./fixtures/clouds";
import { CRACK, IMAGE, SOURCE, decodedColours, nadirCamera, serveCloudWorld } from "./fixtures/cloudWorld";
import {
  API,
  P,
  SWIFTSHADER,
  arrival,
  clickCanvas,
  diagnosticsOn,
  pinStates,
  viewerSettled,
  visiblePins,
  ws,
} from "./fixtures/cloudWorkspace";
import { jsonReply } from "./mock";

// C-G Task 4: one cloud from open to a graded 3D finding with a linked area and a photo. The routes
// are a small stateful backend (fixtures/cloudWorld.ts): each step reads what the step before wrote.
test.use(SWIFTSHADER);
test.beforeEach(async ({ page }) => diagnosticsOn(page));

/** Selects a toggle row (FindingsTab / MeasurementsTab rows are aria-pressed toggles): never unselects. */
async function choose(row: Locator): Promise<void> {
  if ((await row.getAttribute("aria-pressed")) !== "true") await row.click();
  await expect(row).toHaveAttribute("aria-pressed", "true");
}

/** The Images workspace's own reads for the photo the jump opens (I-FW; images-workspace.spec's shape). */
async function routeImages(page: Page): Promise<void> {
  await page.route(`**${API}/images/index*`, (r) =>
    r.fulfill(
      jsonReply({ total: 1, ids: [IMAGE], sev: [0], count: [0], flags: [0], lon: [null], lat: [null] }),
    ),
  );
  // `nadirCamera()` is a 4000 x 3000 photo, and I-FW drops an arrival whose pixel is outside the
  // stored image (useArrival's `withinImage`), so the row carries the camera's size (C-L1's
  // `routeImageRow` answers 2048 x 1536).
  await page.route(
    (u) => u.pathname === `${API}/images/${IMAGE}`,
    (route) => route.fulfill(jsonReply(imageRow)),
  );
}

const imageRow = {
  id: IMAGE,
  path: "images/flight/DJI_0712.JPG",
  file_name: "DJI_0712.JPG",
  width: 4000,
  height: 3000,
  source_id: SOURCE,
  group_key: "0001",
  capture_time: "2026-05-04T08:12:00Z",
  lat: 28.7043,
  lon: 48.375,
  alt: 60,
  phash: null,
  box_count: 0,
  pending_count: 0,
  max_pending_confidence: null,
  labeled: false,
  marked_empty: false,
  created_at: "2026-05-04T09:00:00Z",
  finding_count: 0,
  worst_severity: null,
  reviewed: false,
  camera: {
    rel_alt: 60,
    gimbal_pitch: -90,
    gimbal_yaw: 0,
    focal_mm: 8.8,
    focal_px: null,
    sensor_w_mm: 13.2,
    lrf_distance_m: null,
    subject_distance_m: null,
    distance_m: 60,
    distance_sigma_m: 3,
    distance_source: "rel_alt",
    gsd_mm: 17,
    camera_model: "FC7303",
  },
  footprint: null,
  footprint_kind: "none",
};

test("a cloud becomes a graded 3D finding with a linked area, a report view and a photo", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const world = await serveCloudWorld(page, { cameras: nadirCamera() });
  await routeImages(page);
  const w = ws(page);
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  await viewerSettled(page);

  // 1. W1 + V1: the workspace is up; colour by elevation
  await expect(w.tool("Orbit")).toHaveAttribute("aria-pressed", "true");
  await w.openTopic("Layers"); // Colour by lives in the Layers topic (workspace-rail spec §3.2)
  await w.colour("Elevation").click();
  await expect(w.colour("Elevation")).toHaveAttribute("aria-checked", "true");

  // 2. M1 + B1: an area of four picks, closed with Enter
  await page.keyboard.press("q");
  await expect(w.tool("Area")).toHaveAttribute("aria-pressed", "true");
  for (const [dx, dy] of [
    [-60, -40],
    [60, -40],
    [60, 40],
    [-60, 40],
  ])
    await clickCanvas(page, dx, dy);
  await page.keyboard.press("Enter");
  await expect.poll(() => world.measurementPosts.length).toBe(1);
  const area = world.measurementPosts[0] as { kind: string; points: unknown[]; params: { mode: string } };
  expect(area.kind).toBe("area");
  expect(area.points).toHaveLength(4);
  expect(area.params.mode).toBe("surface");
  await w.openTopic("Measure");
  await expect(w.measurementRow("Area 1")).toContainText("m²");

  // 3. R1 + B4: the measurement's report view arrives, 1600 x 1000 and not blank, drawn in elevation
  await expect
    .poll(() => world.viewPuts.filter((v) => v.kind === "cloud_measurement").length, { timeout: 20_000 })
    .toBe(1);
  const mView = world.viewPuts.find((v) => v.kind === "cloud_measurement")!;
  expect([mView.width, mView.height]).toEqual([1600, 1000]);
  expect(mView.meta).toMatchObject({
    pose: expect.any(Object),
    render: expect.objectContaining({ colour_mode: "elevation" }),
  });

  // 4. P1 + F: a pin, its type chosen in the draft callout, created with Enter
  await page.keyboard.press("Escape");
  await page.keyboard.press("m");
  await expect(w.tool("Pin a finding")).toHaveAttribute("aria-pressed", "true");
  await clickCanvas(page, 0, 0);
  await expect(w.createForm).toBeVisible();
  await w.createForm.getByRole("button", { name: /^Type:/ }).click();
  await page.getByRole("listbox").getByText(CRACK.name).click();
  // the pick moves focus to the note; a plain Enter there creates (C-P1 final-review ruling)
  await expect(w.createForm.getByRole("textbox", { name: "Note" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => world.findingPosts.length).toBe(1);
  const anchor = (world.findingPosts[0] as { anchor: Record<string, unknown> }).anchor;
  // F's cloud anchor exactly, no extra fields (spec C10)
  expect(Object.keys(anchor).sort()).toEqual(["cloud_id", "kind", "uncertainty_m", "x", "y", "z"]);
  expect(anchor).toMatchObject({ kind: "cloud", cloud_id: CLOUD });
  expect((world.findingPosts[0] as { type_id: string }).type_id).toBe(CRACK.id);
  const findingId = world.findings[0].id as string;
  // `pins()` rows of hidden pins carry NaN x/y (C-P1 hand-off): the new pin must be on screen
  await expect.poll(async () => (await visiblePins(page)).map((p) => p.id)).toContain(findingId);

  // 5. R1 + B4 (§15 item 12a, G's part): the finding's view after the create, with the pin's normal
  // in its meta and a pose, and not a blank read-back
  await expect
    .poll(() => world.viewPuts.filter((v) => v.kind === "finding").length, { timeout: 20_000 })
    .toBe(1);
  const fView = world.viewPuts.find((v) => v.kind === "finding")!;
  expect(fView.id).toBe(findingId);
  expect([fView.width, fView.height]).toEqual([1600, 1000]);
  expect(fView.meta).toMatchObject({
    pose: { position: expect.any(Array), target: expect.any(Array) },
    anchor_normal: expect.any(Array),
  });
  expect(fView.meta.anchor_normal as number[]).toHaveLength(3);
  const colours = await decodedColours(page, fView.image);
  expect(colours.distinct).toBeGreaterThanOrEqual(2);
  expect(colours.nonBackground).toBeGreaterThan(0.01);

  // 6. Findings topic + F's review key: severity 3 (Crack's default is 2) on the selected finding
  await page.keyboard.press("Escape");
  await w.openTopic("Findings");
  await choose(w.findingRow("F-0001"));
  await page.keyboard.press("3");
  await expect.poll(() => world.findingPatches.find((p) => p.id === findingId)?.severity).toBe(3);

  // 6b. R1 + P1 (§15 item 12b, G's part): Refresh view sends the camera exactly as it is on screen.
  // The whole-site distance tells it apart from auto framing, which clamps to 6..60 m.
  const onScreen = await page.evaluate(() => window.__kestrelCloudViewer!.cameraPose()!);
  const onScreenDistance = Math.hypot(...onScreen.position.map((v, i) => v - onScreen.target[i]));
  expect(onScreenDistance).toBeGreaterThan(60);
  const putsBefore = world.viewPuts.length;
  await expect(w.refreshView).toBeEnabled({ timeout: 20_000 });
  await w.refreshView.click();
  await expect.poll(() => world.viewPuts.length, { timeout: 20_000 }).toBe(putsBefore + 1);
  const refreshed = world.viewPuts.at(-1)!;
  expect(refreshed).toMatchObject({ kind: "finding", id: findingId, width: 1600, height: 1000 });
  const pose = refreshed.meta.pose as { position: number[]; target: number[] };
  for (let i = 0; i < 3; i++) {
    expect(pose.position[i]).toBeCloseTo(onScreen.position[i], 3);
    expect(pose.target[i]).toBeCloseTo(onScreen.target[i], 3);
  }

  // 7. M1: attach the area to the finding
  // Area 1 is still selected from step 2, but the finding (selected since) is the latest selection,
  // which the inspector shows (ruling R10). Esc in Orbit clears the finding: the area shows again.
  await page.keyboard.press("Escape");
  await w.openTopic("Measure");
  await choose(w.measurementRow("Area 1"));
  await w.attachFinding.click();
  await page.getByRole("option", { name: /F-0001/ }).click();
  await expect
    .poll(() => world.measurementPatches.find((p) => p.finding_id === findingId)?.finding_id)
    .toBe(findingId);

  // 8. P1: the finding's inspector lists the linked measurement (C's measureSlot)
  await w.openTopic("Findings");
  await choose(w.findingRow("F-0001"));
  await expect(w.linkedMeasurements).toContainText("Area 1");

  // 9. L1 + I-FW (ruling G10: merged): which photos saw this point; the top hit opens the image at
  // the spot with I-FW's arrival ring and its "Back to 3D" chip, which returns to the cloud
  await page.keyboard.press("Escape");
  await page.keyboard.press("i");
  await expect(w.tool("Photo link")).toHaveAttribute("aria-pressed", "true");
  await clickCanvas(page, 0, 0);
  await expect(w.photoList).toBeVisible();
  // I-FW rewrites the URL to a clean one once it has read the arrival, so race the wait with the click
  const jump = new RegExp(`/p/${P}/images/${IMAGE}\\?at=[\\d.]+,[\\d.]+&r=\\d+&from=cloud(:|%3A)${CLOUD}`);
  await Promise.all([page.waitForURL(jump), w.photoList.getByRole("button").first().click()]);
  const land = arrival(page);
  // the ring is drawn by Konva; its hidden DOM probe carries the spot (images-workspace.spec asserts the same)
  await expect(land.ring).toHaveAttribute("data-at", /^[\d.]+,[\d.]+$/, { timeout: 20_000 });
  await expect(land.backTo3d).toBeVisible();
  await expect(land.backTo3d).toHaveAttribute("href", `/p/${P}/clouds/${CLOUD}`);
  await expect(page).toHaveURL(new RegExp(`/p/${P}/images/${IMAGE}$`));
  await land.backTo3d.click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/clouds/${CLOUD}$`));
  await viewerSettled(page);

  // 10. reload the workspace: the pin and the measurement come back from the backend
  await page.reload();
  await viewerSettled(page);
  await expect.poll(async () => (await pinStates(page)).map((p) => p.id)).toContain(findingId);
  await w.openTopic("Measure");
  await expect(w.measurementRow("Area 1")).toBeVisible();
});
