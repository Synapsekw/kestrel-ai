import { test, expect } from "@playwright/test";

const P = "7f1c2e3a-1111-4000-8000-000000000001";
const IMG = "10000000-5555-4000-8000-000000000001";
const IMG2 = "10000000-5555-4000-8000-000000000002";

test("lists images with the default query and shows the seven columns in list view", async ({ page }) => {
  const first = page.waitForRequest(
    (r) => r.method() === "GET" && r.url().includes(`/api/v1/projects/${P}/images?`),
  );
  await page.goto(`/p/${P}/data`);
  const url = new URL((await first).url());
  expect(url.searchParams.get("sort")).toBe("path");
  expect(url.searchParams.get("order")).toBe("asc");
  expect(url.searchParams.get("limit")).toBe("200");
  await expect(page.getByRole("heading", { name: "Images", exact: true })).toBeVisible();
  await expect(page.getByTestId("image-grid")).toBeVisible();
  await expect(page.getByText("IX-12-02491_0031_0001.jpg")).toBeVisible();
  await expect(page.getByText("2 of 2 images")).toBeVisible();

  await page.getByRole("radio", { name: "List" }).click();
  await expect(page.getByTestId("image-table")).toBeVisible();
  const headers = await page.getByRole("columnheader").allTextContents();
  for (const label of ["File", "Source", "Group", "Labeled", "Boxes", "Pending", "Captured"]) {
    expect(headers.some((h) => h.startsWith(label))).toBe(true);
  }
  await expect(page.getByRole("row").filter({ hasText: "IX-12-02491_0031_0001.jpg" })).toContainText(
    "2019-04-15 06:35",
  );
});

test("sorting by a column header and filtering change the request", async ({ page }) => {
  await page.goto(`/p/${P}/data`);
  await page.getByRole("radio", { name: "List" }).click();
  const sorted = page.waitForRequest(
    (r) => r.url().includes("sort=box_count") && r.url().includes("order=asc"),
  );
  await page.getByRole("columnheader", { name: "Boxes" }).click();
  await sorted;
  const reversed = page.waitForRequest(
    (r) => r.url().includes("sort=box_count") && r.url().includes("order=desc"),
  );
  await page.getByRole("columnheader", { name: /Boxes/ }).click();
  await reversed;

  const labeled = page.waitForRequest((r) => r.url().includes("labeled=true"));
  await page.getByLabel("Labeled").selectOption("yes");
  await labeled;
  const pending = page.waitForRequest((r) => r.url().includes("has_pending=false"));
  await page.getByLabel("Pending review").selectOption("no");
  await pending;
  const searched = page.waitForRequest((r) => r.url().includes("search=0031"));
  await page.getByPlaceholder("Search file name").fill("0031");
  await searched;
  const grouped = page.waitForRequest((r) => r.url().includes("group_key=IX"));
  await page.getByLabel("Flight or tile").fill("IX");
  await grouped;
});

test("multi-select with checkboxes and bulk delete after confirmation", async ({ page }) => {
  await page.goto(`/p/${P}/data`);
  await page.getByRole("radio", { name: "List" }).click();
  await page.getByLabel("Select IX-12-02491_0031_0001.jpg").check();
  await page.getByLabel("Select IX-12-02491_0031_0002.jpg").check();
  await expect(page.getByText("2 selected")).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const deleted = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/images/bulk-delete"),
  );
  await page.getByRole("button", { name: "Delete 2 images" }).click();
  expect((await deleted).postDataJSON()).toEqual({ image_ids: [IMG, IMG2] });
  // The mock answers with its example count of 1, hence the singular form.
  await expect(page.getByRole("status")).toContainText(/images? deleted/);
});

test("multi-select and mark as empty reports the result (E4)", async ({ page }) => {
  await page.goto(`/p/${P}/data`);
  await page.getByRole("radio", { name: "List" }).click();
  await page.getByLabel("Select IX-12-02491_0031_0001.jpg").check();
  await page.getByLabel("Select IX-12-02491_0031_0002.jpg").check();
  await page.getByRole("button", { name: "Mark as empty" }).click();
  await expect(page.getByText(/Mark 2 images as empty\?/)).toBeVisible();
  const marked = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/images/bulk-mark-empty"),
  );
  await page.getByRole("button", { name: "Mark 2 as empty" }).click();
  expect((await marked).postDataJSON()).toEqual({ image_ids: [IMG, IMG2], marked_empty: true });
  // The mock answers its example {updated: 1, skipped: 0}.
  await expect(page.getByRole("status")).toContainText("1 marked as empty");
});

test("run model opens the query screen with the selection; add to dataset posts the ids with the seed", async ({
  page,
}) => {
  await page.goto(`/p/${P}/data`);
  await page.getByRole("radio", { name: "List" }).click();
  await page.getByLabel("Select IX-12-02491_0031_0001.jpg").check();
  await page.getByRole("button", { name: "Run model" }).click();
  await page.waitForURL(`**/p/${P}/query`);
  await expect(page.getByLabel("Images")).toHaveValue("selection");
  await expect(page.getByTestId("image-count")).toHaveText("1 image selected");

  await page.goBack();
  await page.getByRole("radio", { name: "List" }).click();
  await page.getByLabel("Select IX-12-02491_0031_0001.jpg").check();
  await page.getByRole("button", { name: "Add to dataset" }).click();
  await page.getByLabel("Dataset name").fill("v1");
  await page.getByRole("button", { name: "Split options" }).click();
  await page.getByLabel("Seed").fill("7");
  const dataset = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/datasets"));
  await page.getByRole("button", { name: "Create dataset" }).click();
  expect((await dataset).postDataJSON()).toEqual({
    name: "v1",
    split_method: "by_group",
    val_fraction: 0.2,
    seed: 7,
    image_ids: [IMG],
  });
  await expect(page.getByRole("dialog", { name: "Add to dataset" }).getByTestId(/^job-/)).toBeVisible();
  await expect(page.getByRole("button", { name: "1 active job" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Train on it" })).toHaveAttribute("href", `/p/${P}/train`);
});

test("J, K and Enter open the focused image with the list as navigation context", async ({ page }) => {
  await page.goto(`/p/${P}/data`);
  await expect(page.getByText("IX-12-02491_0031_0002.jpg")).toBeVisible();
  await page.getByTestId("image-grid").focus();
  await page.keyboard.press("j");
  await page.keyboard.press("Enter");
  await page.waitForURL(`**/p/${P}/edit/${IMG2}`);
  await expect(page.getByTestId("position")).toHaveText("2 / 2");
  await expect(page.getByText("Loading…")).toHaveCount(0);
  await page.keyboard.press("Control+ArrowLeft");
  await page.waitForURL(`**/p/${P}/edit/${IMG}`);
});

test("label selected opens the editor over the selection only", async ({ page }) => {
  await page.goto(`/p/${P}/data`);
  await page.getByRole("radio", { name: "List" }).click();
  await page.getByLabel("Select IX-12-02491_0031_0002.jpg").check();
  await page.getByRole("button", { name: "Label selected" }).click();
  await page.waitForURL(`**/p/${P}/edit/${IMG2}`);
  await expect(page.getByTestId("position")).toHaveText("1 / 1");
});

test("double-click opens a list row even though the first click selects it", async ({ page }) => {
  await page.goto(`/p/${P}/data`);
  await page.getByRole("radio", { name: "List" }).click();
  const name = page.getByTestId("image-table").getByText("IX-12-02491_0031_0001.jpg");
  const before = await name.boundingBox();
  await name.click();
  // The selection bar that appears must not move the rows: the second click of a double-click
  // has to land on the same row.
  await expect(page.getByText("1 selected")).toBeVisible();
  expect((await name.boundingBox())?.y).toBe(before?.y);
  await name.dblclick();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/edit/${IMG}$`));
});
