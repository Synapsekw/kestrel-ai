import { test, expect } from "@playwright/test";

const P = "7f1c2e3a-1111-4000-8000-000000000001";

test("stores a key without echoing it, tests, patches and removes a key", async ({ page }) => {
  await page.goto(`/p/${P}/settings`);
  await expect(page.getByRole("heading", { name: "Provider keys" })).toBeVisible();
  await expect(page.getByTestId("key-state-openai")).toHaveText("No key stored");
  await expect(page.getByTestId("key-state-anthropic")).toHaveText("Key stored");

  const keyInput = page.getByLabel("OpenAI API key");
  await expect(keyInput).toHaveAttribute("type", "password");
  await keyInput.fill("sk-test-123");
  const put = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/providers/openai/key"));
  await page.getByRole("button", { name: "Save OpenAI key" }).click();
  expect((await put).postDataJSON()).toEqual({ api_key: "sk-test-123" });
  await expect(keyInput).toHaveValue("");
  await expect(page.getByTestId("key-state-openai")).toHaveText("Key stored");
  expect(await page.content()).not.toContain("sk-test-123");

  const tested = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/providers/anthropic/test"),
  );
  await page.getByRole("button", { name: "Test Anthropic" }).click();
  await tested;
  await expect(
    page.getByRole("status").filter({ hasText: "OK: responded in 1.2 s (claude-opus-5)" }),
  ).toBeVisible();

  await page.getByLabel("Anthropic requests per minute").fill("10");
  const patched = page.waitForRequest(
    (r) => r.method() === "PATCH" && r.url().endsWith("/providers/anthropic"),
  );
  await page.getByRole("button", { name: "Save Anthropic settings" }).click();
  expect((await patched).postDataJSON()).toEqual({ requests_per_minute: 10 });

  const removed = page.waitForRequest(
    (r) => r.method() === "DELETE" && r.url().endsWith("/providers/anthropic/key"),
  );
  await page.getByRole("button", { name: "Remove Anthropic key" }).click();
  await removed;
  await expect(page.getByTestId("key-state-anthropic")).toHaveText("No key stored");
  await expect(page.getByRole("button", { name: "Remove Anthropic key" })).toBeDisabled();
});

test("a 501 from providers shows the note and leaves the other settings sections working", async ({
  page,
}) => {
  await page.route(
    (url) => url.pathname === "/api/v1/providers",
    (route) =>
      route.fulfill({
        status: 501,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          error: { code: "not_implemented", message: "providers arrive with S4", details: {} },
        }),
      }),
  );
  await page.goto(`/p/${P}/settings`);
  await expect(
    page.getByRole("note").filter({ hasText: "Cloud providers are not available yet" }),
  ).toBeVisible();
  await expect(page.getByLabel("Pre-annotation model")).toBeEnabled();
  await expect(page.getByRole("button", { name: "Save classes" })).toBeVisible();
});
