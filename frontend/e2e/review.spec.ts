import { test, expect } from "@playwright/test";

const P = "7f1c2e3a-1111-4000-8000-000000000001";
const IMG = "10000000-5555-4000-8000-000000000001";

test("review queue asks for pending images by confidence, shows the confidence column and opens the editor", async ({
  page,
}) => {
  const queue = page.waitForRequest((r) => {
    if (r.method() !== "GET" || !r.url().includes(`/api/v1/projects/${P}/images?`)) return false;
    const q = new URL(r.url()).searchParams;
    return q.get("has_pending") === "true" && q.get("sort") === "max_pending_confidence" && q.get("order") === "desc";
  });
  await page.goto(`/p/${P}/review`);
  await queue;
  await expect(page.getByRole("heading", { name: "Review queue" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /Top confidence/ })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "IX-12-02491_0031_0001.jpg" })).toContainText("81%");
  await expect(page.getByText("2 images waiting")).toBeVisible();

  await page.getByTestId("image-table").focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(`**/p/${P}/edit/${IMG}`);
  await expect(page.getByTestId("position")).toHaveText("1 / 2");
  await expect(page.getByTestId("proposal-count")).toHaveText("1 proposal");
  const accepted = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/boxes/review"));
  await page.keyboard.press("a");
  expect((await accepted).postDataJSON()).toEqual({
    box_ids: ["b0000000-6666-4000-8000-000000000002"],
    action: "accept",
  });
});
