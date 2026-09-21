import { test, expect, type Page } from "@playwright/test";
import { evidencePath } from "./evidence";

const projectId = "8f1c2e3a-1111-4000-8000-000000000001";
const stamp = "2026-09-21T16:00:00Z";
const plan = {
  name: "Crane survey",
  classes: ["crane", "dump_truck"],
  starter_model_key: "yolo26n",
  image_guidance: "Choose varied flights, camera angles and lighting. Include empty scenes.",
  labeling_query: "Find cranes and dump trucks, drawing tight bounding boxes.",
};
const project = {
  id: projectId,
  name: plan.name,
  folder: "E:\\Projects\\Crane survey",
  schema_version: 1,
  classes: plan.classes.map((name, i) => ({
    id: `class-${i}`,
    name,
    colour: "#e5af64",
    order: i,
    hotkey: null,
  })),
  preannotation_model_id: null,
  created_at: stamp,
  import_defaults: { max_side: 4000, quality: 95, dedupe_threshold: 4, group_regex: "" },
};
const images = [1, 2].map((i) => ({
  id: `image-${i}`,
  file_name: `survey-${i}.jpg`,
  path: `images/survey-${i}.jpg`,
  width: 1280,
  height: 960,
  source_id: "source-1",
  group_key: "flight-1",
  capture_time: null,
  lat: null,
  lon: null,
  alt: null,
  phash: null,
  box_count: 0,
  pending_count: 0,
  max_pending_confidence: null,
  labeled: false,
  marked_empty: false,
  created_at: stamp,
}));
function job(id: string, type = "import") {
  return {
    id,
    project_id: projectId,
    type,
    state: "succeeded",
    progress: 1,
    message: "Finished",
    params: {},
    result: id === "starter-job" ? { model_id: "model-1" } : {},
    error: null,
    log_path: `runs/${id}/job.log`,
    created_at: stamp,
    started_at: stamp,
    finished_at: stamp,
  };
}
async function setupRoutes(page: Page, hasKey = true) {
  const requests: { path: string; method: string; body: Record<string, unknown> | null }[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (method === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Allow-Methods": "*",
        },
      });
    const body = request.postData() ? request.postDataJSON() : null;
    requests.push({ path: path + url.search, method, body });
    let result: unknown;
    let status = 200;
    if (path.endsWith("/providers"))
      result = {
        items: [
          {
            name: "openai",
            has_key: hasKey,
            model_name: "Test GPT",
            requests_per_minute: 30,
            cost_per_request: 0.02,
          },
        ],
      };
    else if (path.endsWith("/starter-models"))
      result = {
        items: [
          {
            key: "yolo26n",
            name: "YOLO26 nano",
            family: "YOLO26",
            task: "detect",
            description: "Small detector for a first experiment",
            available: true,
            size_mb: 5,
          },
        ],
        next_cursor: null,
      };
    else if (path.endsWith("/agent/chat"))
      result = {
        message: "I suggest two clear classes. Review the plan, then choose your folders.",
        plan,
        model_name: "Test GPT",
      };
    else if (path === "/api/v1/projects" && method === "POST") {
      result = project;
      status = 201;
    } else if (path === "/api/v1/projects") result = { items: [], next_cursor: null };
    else if (path.endsWith("/acquire-starter")) {
      result = { job: job("starter-job") };
      status = 202;
    } else if (path.endsWith("/sources") && method === "POST") {
      result = { source: { id: "source-1" }, job: job("source-job") };
      status = 202;
    } else if (path.endsWith("/images")) result = { items: images, next_cursor: "another-page" };
    else if (path.includes("/thumbnail"))
      return route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="120"><rect width="180" height="120" fill="#807456"/><rect x="55" y="40" width="45" height="35" fill="#e5af64"/></svg>',
      });
    else if (path.endsWith("/query-runs/estimate"))
      result = { images: 1, tiles: 1, requests: 1, estimated_cost: 0.02, cost_per_request: 0.02 };
    else if (path.endsWith("/query-runs") && method === "POST") {
      result = { query_run: { id: "run-1", image_ids: [images[0].id] }, job: job("label-job", "infer") };
      status = 202;
    } else if (path.includes("/jobs/")) result = job(path.split("/").at(-1)!);
    else if (path === `/api/v1/projects/${projectId}`) result = project;
    else return route.fallback();
    return route.fulfill({
      status,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(result),
    });
  });
  return requests;
}

test("setup agent guides a bounded first labeling run and retains its plan", async ({ page }) => {
  const requests = await setupRoutes(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Setup agent", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Setup agent" });
  await expect(drawer).toBeVisible();
  await drawer
    .getByLabel("Message", { exact: true })
    .fill("Build a detector for cranes and dump trucks in aerial photos");
  await drawer.getByRole("button", { name: "Send", exact: true }).click();
  await expect(drawer.getByLabel("Project name")).toHaveValue(plan.name);
  await drawer.getByLabel("Project name").fill("West site survey");
  await drawer.getByRole("button", { name: "Close setup agent" }).click();
  await expect(page.getByRole("button", { name: "Setup agent", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Setup agent", exact: true }).click();
  await expect(drawer.getByLabel("Project name")).toHaveValue("West site survey");
  await drawer.getByLabel("Project folder").fill(project.folder);
  await page.screenshot({
    path: evidencePath("setup-agent", "project-plan.png"),
    fullPage: true,
    animations: "disabled",
  });
  await drawer.getByRole("button", { name: "Create project", exact: true }).click();
  await drawer.getByLabel("Image folder").fill("E:\\Images\\survey");
  await drawer.getByRole("button", { name: "Import images", exact: true }).click();
  await drawer.getByLabel("Select survey-1.jpg").check();
  const imageReads = requests.filter((r) => r.path.includes("/images?") && r.path.includes("limit=24"));
  expect(imageReads).toHaveLength(1);
  expect(imageReads[0].path).toContain("limit=24");
  expect(
    requests
      .filter((r) => r.path.includes("/images?"))
      .every((r) => Number(new URL(r.path, "http://test").searchParams.get("limit")) <= 24),
  ).toBe(true);
  await drawer.getByRole("button", { name: "Estimate first labeling" }).click();
  await expect(drawer.getByTestId("estimate")).toContainText("0.02");
  await page.screenshot({
    path: evidencePath("setup-agent", "image-selection.png"),
    fullPage: true,
    animations: "disabled",
  });
  await drawer.getByLabel("Labeling instructions").fill("Only fully visible cranes and trucks");
  await expect(drawer.getByRole("button", { name: "Start first labeling" })).toBeDisabled();
  await drawer.getByRole("button", { name: "Estimate first labeling" }).click();
  await drawer.getByRole("button", { name: "Start first labeling" }).click();
  await expect(drawer.getByRole("link", { name: "Review suggestions" })).toBeVisible();
  expect(requests.filter((r) => r.method === "POST" && r.path === "/api/v1/projects")).toHaveLength(1);
  expect(requests.find((r) => r.method === "POST" && r.path.endsWith("/query-runs"))?.body).toMatchObject({
    image_ids: [images[0].id],
    provider: "openai",
    query: "Only fully visible cranes and trucks",
  });
  expect(requests.some((r) => r.path.includes("/promote"))).toBe(false);
  await page.screenshot({
    path: evidencePath("setup-agent", "first-labeling.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("missing credentials give a settings route at narrow laptop width", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await setupRoutes(page, false);
  await page.goto("/");
  await page.getByRole("button", { name: "Setup agent", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Setup agent" });
  await expect(drawer.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  await expect(drawer.getByRole("link", { name: "App settings" })).toHaveAttribute("href", "/settings");
  await expect(drawer).toBeInViewport();
  await page.screenshot({
    path: evidencePath("setup-agent", "missing-key.png"),
    fullPage: true,
    animations: "disabled",
  });
});
