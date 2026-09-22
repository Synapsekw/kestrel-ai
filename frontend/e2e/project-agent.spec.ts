import { test, expect } from "@playwright/test";

// The Project example in openapi.yaml, served by the mock, has anthropic has_key: true, and the
// AgentConversation example is an idle, empty conversation.
const P = "7f1c2e3a-1111-4000-8000-000000000001";

test("opens the project agent from the project header, sends a message, and starts a turn", async ({
  page,
}) => {
  await page.goto(`/p/${P}`);
  await expect(page.getByRole("banner")).toContainText("Home");
  await page.getByRole("button", { name: "Project agent", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Project agent" });
  await expect(drawer).toBeVisible();
  await drawer
    .getByLabel("Message", { exact: true })
    .fill("Label the first 5 images with excavator and dump_truck");
  const started = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith(`/projects/${P}/agent/turns`),
  );
  await drawer.getByRole("button", { name: "Send", exact: true }).click();
  const request = await started;
  expect(request.postDataJSON()).toMatchObject({
    provider: "anthropic",
    message: "Label the first 5 images with excavator and dump_truck",
  });
});
