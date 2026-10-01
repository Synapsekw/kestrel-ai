import { test, expect, type Page } from "@playwright/test";
import { fromMock, jsonReply } from "./mock";

// S1-U5: the setup page against the Prism mock. The setup endpoints are answered by page.route, so the
// flow does not depend on U2/U3 being merged; U6's journey covers the real backend. Playwright can do
// neither a Tauri drop nor a native dialog, so the flow types the path (coordinator ruling).
const P = "7f1c2e3a-1111-4000-8000-000000000001";
const JOB = "j0000000-4444-4000-8000-000000000091";
const FOLDER = "E:\\DCIM\\100MEDIA";
const T0 = "2026-09-30T00:00:00Z";

const spec = (name: string, kind: "defect" | "object", severity: number, hotkey: string) => ({
  name,
  kind,
  colour: "#ff9c3a",
  default_severity: severity,
  hotkey,
  definition: `${name}, in one sentence.`,
  severity_rules: [],
});

const VERTICAL = {
  id: "builtin-vertical",
  name: "Vertical asset inspection",
  description: "Towers, turbines, chimneys and façades.",
  builtin: true,
  created_at: T0,
  updated_at: T0,
  config: {
    config_version: 1,
    slots: [
      { key: "visual", label: "Visual photos", route: "images", required: true, accepts: ["jpg", "jpeg", "dng"], match: { thermal: false } },
      { key: "thermal", label: "Thermal photos", route: "images", required: false, accepts: ["jpg", "jpeg"], match: { thermal: true } },
      { key: "cloud", label: "3D point cloud", route: "pointcloud", required: false, accepts: ["las", "laz"], match: null },
      { key: "drawings", label: "Asset drawings", route: "drawing", required: false, accepts: ["pdf", "dxf"], match: null },
    ],
    types: [
      spec("Corrosion", "defect", 2, "1"),
      spec("Coating damage", "defect", 1, "2"),
      spec("Loose / missing bolt", "defect", 3, "3"),
      spec("Antenna misalignment", "defect", 3, "4"),
      spec("Bird nest", "object", 2, "5"),
      spec("Thermal hot spot", "defect", 4, "6"),
      spec("Cracked weld", "defect", 4, "7"),
    ],
  },
};

const photos = (thermal: boolean, count: number) => ({
  route: "images",
  match: { thermal },
  slot_key: thermal ? "thermal" : "visual",
  folder: FOLDER,
  files: [],
  count,
  bytes: count * 12_000_000,
  samples: [],
  crs: null,
});

const RESULT = {
  buckets: [photos(false, 612), photos(true, 88)],
  not_recognised: { count: 1, samples: [{ name: "Thumbs.db", reason: "unknown type" }] },
  suggested_template_id: "builtin-vertical",
  truncated: false,
};

const sortJob = (done: boolean) => ({
  id: JOB,
  project_id: "library",
  type: "setup_inspect",
  state: done ? "succeeded" : "running",
  progress: done ? 1 : 0.3,
  message: done ? "Sorted 701 files" : "Reading headers 6 / 20",
  log_path: `runs/${JOB}/job.log`,
  params: { paths: [FOLDER] },
  result: done ? RESULT : null,
  error: null,
  created_at: T0,
  started_at: T0,
  finished_at: done ? T0 : null,
});

const DOWN = { error: { code: "catalogue_unavailable", message: "catalogue.db could not be opened", details: {} } };

interface Seen {
  inspects: unknown[];
  ensures: { types: { name: string }[]; dry_run?: boolean }[];
  creates: Record<string, unknown>[];
}

async function answerSetup(page: Page, catalogue: "up" | "down" = "up"): Promise<Seen> {
  const seen: Seen = { inspects: [], ensures: [], creates: [] };
  const example = await fromMock(page, `/api/v1/projects/${P}`);
  let reads = 0;
  await page.route(
    (u) => u.pathname === "/api/v1/project-templates",
    (r) => r.fulfill(catalogue === "down" ? jsonReply(DOWN, 503) : jsonReply({ items: [VERTICAL] })),
  );
  await page.route(
    (u) => u.pathname === "/api/v1/catalogue/types",
    (r) => r.fulfill(catalogue === "down" ? jsonReply(DOWN, 503) : jsonReply({ items: [], next_cursor: null })),
  );
  await page.route(
    (u) => u.pathname === "/api/v1/library/status",
    (r) => r.fulfill(jsonReply({ available: true, root: "C:\\library", error: null })),
  );
  await page.route(
    (u) => u.pathname === "/api/v1/catalogue/types/ensure",
    (r) => {
      const body = r.request().postDataJSON() as Seen["ensures"][number];
      seen.ensures.push(body);
      return r.fulfill(
        jsonReply({
          items: body.types.map((t, i) => ({
            name: t.name,
            id: body.dry_run ? null : `t-${i + 1}`,
            created: !body.dry_run,
            conflict: null,
          })),
        }),
      );
    },
  );
  await page.route(
    (u) => u.pathname === "/api/v1/setup/inspect",
    (r) => {
      seen.inspects.push(r.request().postDataJSON());
      return r.fulfill(jsonReply({ job: sortJob(false) }, 202));
    },
  );
  await page.route(
    (u) => u.pathname === `/api/v1/library/jobs/${JOB}`,
    (r) => {
      reads += 1;
      return r.fulfill(jsonReply(sortJob(reads > 1)));
    },
  );
  await page.route(
    (u) => u.pathname === "/api/v1/projects",
    (r) => {
      if (r.request().method() !== "POST") return r.fulfill(jsonReply({ items: [], next_cursor: null }));
      seen.creates.push(r.request().postDataJSON() as Record<string, unknown>);
      return r.fulfill(jsonReply(example, 201));
    },
  );
  return seen;
}

test("New project opens the setup page; a sorted folder, the template's types, the draft kept, Create", async ({
  page,
}) => {
  const seen = await answerSetup(page);
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).click();
  await expect(page).toHaveURL(/\/projects\/new$/);

  await page.getByRole("radio", { name: /^Vertical asset inspection/ }).click();
  await expect(page.getByRole("list", { name: "Anomaly types" }).getByRole("listitem")).toHaveCount(7);
  await page.locator("#project-name").fill("Mast SR-0412");
  await page.locator("#project-folder").fill("E:\\Projects\\SR-0412");

  await page.getByRole("textbox", { name: "Folder or file path" }).fill(FOLDER);
  await page.getByRole("button", { name: "Sort files" }).click();
  await expect(
    page.getByRole("region", { name: "Visual photos" }).getByRole("listitem", { name: "100MEDIA · visual" }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByRole("region", { name: "Thermal photos" }).getByRole("listitem", { name: "100MEDIA · thermal" }),
  ).toBeVisible();
  await expect(page.getByText("Visual and thermal photos in the same folder are imported together.")).toBeVisible();
  expect(seen.inspects).toEqual([{ paths: [FOLDER], template_id: "builtin-vertical" }]);

  // The draft survives leaving the page.
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Projects", exact: true })
    .click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.getByRole("button", { name: "New project" }).click();
  await expect(page.locator("#project-name")).toHaveValue("Mast SR-0412");
  await expect(
    page.getByRole("region", { name: "Visual photos" }).getByRole("listitem", { name: "100MEDIA · visual" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/overview$`));
  expect(seen.creates).toHaveLength(1);
  expect(seen.creates[0]).toMatchObject({
    name: "Mast SR-0412",
    folder: "E:\\Projects\\SR-0412",
    type_ids: ["t-1", "t-2", "t-3", "t-4", "t-5", "t-6", "t-7"],
    hotkeys: { "t-1": "1", "t-2": "2", "t-3": "3", "t-4": "4", "t-5": "5", "t-6": "6", "t-7": "7" },
  });
  expect(seen.ensures.filter((e) => !e.dry_run)).toHaveLength(1);
});

test("the catalogue unavailable: Blank only, and Create still works with no types", async ({ page }) => {
  const seen = await answerSetup(page, "down");
  await page.goto("/projects/new");
  await expect(page.getByText(/only Blank is offered/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("radio")).toHaveCount(1);
  await page.locator("#project-name").fill("Yard");
  await page.locator("#project-folder").fill("E:\\Projects\\Yard");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/overview$`));
  expect(seen.creates).toEqual([{ name: "Yard", folder: "E:\\Projects\\Yard", type_ids: [] }]);
  expect(seen.ensures).toHaveLength(0);
});

test("below 1100 px the summary is a bottom bar with the checklist in a popover", async ({ page }) => {
  await answerSetup(page);
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto("/projects/new");
  const bar = page.getByRole("region", { name: "Summary" });
  await expect(bar).toBeVisible({ timeout: 15_000 });
  await bar.getByRole("button", { name: "Checklist" }).click();
  await expect(page.getByRole("dialog", { name: "Setup checklist" })).toContainText("Give the project a name.");
  await expect(bar.getByRole("button", { name: "Create project" })).toBeDisabled();
});
