import { expect, test } from "@playwright/test";
import { fulfilJson } from "./fixtures/appSections";
import { EAND, WHITE_LABEL } from "./fixtures/brands";

test("the brand editor previews a colour live, saves it, and creates then deletes a brand", async ({
  page,
}) => {
  let brands: Array<Record<string, unknown>> = [EAND, WHITE_LABEL];
  await page.route(
    (url) => url.pathname === "/api/v1/brands",
    async (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as { name: string };
        const created = {
          ...WHITE_LABEL,
          id: "b-new",
          name: body.name,
          builtin: false,
          font_text: null,
          font_numerals: null,
        };
        brands = [...brands, created];
        return fulfilJson(route, created, 201);
      }
      return fulfilJson(route, { items: brands });
    },
  );
  await page.route(
    (url) => /^\/api\/v1\/brands\/[^/]+$/.test(url.pathname),
    async (route) => {
      const id = new URL(route.request().url()).pathname.split("/").pop();
      if (route.request().method() === "DELETE") {
        brands = brands.filter((b) => b.id !== id);
        return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
      }
      const current = brands.find((b) => b.id === id) ?? EAND;
      const next = {
        ...current,
        ...(route.request().postDataJSON() as object),
        updated_at: "2026-10-03T01:00:00Z",
      };
      brands = brands.map((b) => (b.id === id ? next : b));
      return fulfilJson(route, next);
    },
  );

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Report brands" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("e&");

  const band = page.getByTestId("brand-cover-preview").locator("[data-cover-band]");
  await expect(band).toHaveAttribute("style", /rgb\(20, 29, 45\)|#141D2D/i);
  await page.getByLabel("Accent dark hex").fill("#00AA55");
  await expect(band).toHaveAttribute("style", /rgb\(0, 170, 85\)|#00AA55/i);

  const patch = page.waitForRequest((r) => r.method() === "PATCH");
  await page.getByRole("button", { name: "Save brand" }).click();
  expect((await patch).postDataJSON()).toEqual({ colors: { ...EAND.colors, accent_dark: "#00AA55" } });
  await expect(page.getByText("Saved")).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete brand" })).toHaveCount(0);

  const post = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/api/v1/brands"));
  await page.getByRole("button", { name: "New brand" }).click();
  expect((await post).postDataJSON()).toEqual({ name: "New brand" });
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("New brand");

  await page.getByRole("button", { name: "Delete brand" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete New brand?" });
  const del = page.waitForRequest((r) => r.method() === "DELETE");
  await dialog.getByRole("button", { name: "Delete brand" }).click();
  expect((await del).url()).toMatch(/\/api\/v1\/brands\/b-new$/);
  await expect(
    page.getByRole("list", { name: "Brands" }).getByRole("button", { name: "New brand" }),
  ).toHaveCount(0);
});
