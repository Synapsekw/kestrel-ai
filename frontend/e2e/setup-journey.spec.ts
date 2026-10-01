import { test, expect, type Page } from "@playwright/test";
import { libraryJob } from "./fixtures/appSections";
import { setupUi, sortFolder, VERTICAL_TYPES } from "./fixtures/setupUi";
import { entrancesDone, evidencePath } from "./evidence";
import { fromMock, jsonReply } from "./mock";

// Spec 2026-09-30-project-setup §12 against the Prism mock (plan 2026-09-30-setup-u6, ruling U6-4):
// the setup routes answer from a small stateful fake so the test can pin exactly what Create sends.
// Everything else (the Overview's reads) comes from the mock.

type Json = Record<string, unknown>;

const EXAMPLE_P = "7f1c2e3a-1111-4000-8000-000000000001";
const P = "7f1c2e3a-1111-4000-8000-0000000000e6";
const INSPECT_JOB = "j0000000-4444-4000-8000-0000000000e6";
const INSPECTION = "e0000000-2222-4000-8000-0000000000e6";
const T = "2026-09-30T09:00:00Z";
const DELIVERY = "E:\\Delivery\\Tower 14";
const PHOTOS = `${DELIVERY}\\DCIM\\100MEDIA`;
const PLAN = `${DELIVERY}\\drawings\\tower-elevation.pdf`;
const CLIP = `${DELIVERY}\\video\\walkround.mp4`;
const FOLDER = "E:\\Projects\\Tower 14";

const TEMPLATE = {
  id: "builtin-vertical",
  name: "Vertical asset inspection",
  description: "Towers, masts and other tall structures: visual and thermal photos, a scan, drawings.",
  builtin: true,
  config: {
    config_version: 1,
    slots: [
      {
        key: "visual",
        label: "Visual photos",
        route: "images",
        required: true,
        accepts: ["jpg", "jpeg"],
        match: null,
      },
      {
        key: "thermal",
        label: "Thermal photos",
        route: "images",
        required: false,
        accepts: ["jpg", "jpeg"],
        match: { thermal: true },
      },
      {
        key: "pointcloud",
        label: "3D point cloud",
        route: "pointcloud",
        required: false,
        accepts: ["las", "laz"],
        match: null,
      },
      {
        key: "drawings",
        label: "Asset drawings",
        route: "drawing",
        required: false,
        accepts: ["pdf", "dxf", "xml"],
        match: null,
      },
    ],
    types: VERTICAL_TYPES.map(([name, kind, severity, hotkey]) => ({
      name,
      kind,
      colour: "#ff9c3a",
      default_severity: severity,
      hotkey,
      definition: `${name}, as seen in a close-range photo.`,
      severity_rules: [],
    })),
  },
  created_at: T,
  updated_at: T,
};

const bucket = (
  route: string,
  match: Json,
  slot_key: string | null,
  folder: string,
  files: string[],
  count: number,
  samples: string[],
) => ({
  route,
  match,
  slot_key,
  folder,
  files,
  count,
  bytes: count * 4_000_000,
  samples,
  crs: null,
});

const INSPECT_RESULT = {
  buckets: [
    bucket("images", { thermal: false }, "visual", PHOTOS, [], 2, ["DJI_0001_V.JPG", "DJI_0002_V.JPG"]),
    bucket("images", { thermal: true }, "thermal", PHOTOS, [], 2, ["DJI_0001_T.JPG", "DJI_0002_T.JPG"]),
    bucket("drawing", {}, "drawings", `${DELIVERY}\\drawings`, [PLAN], 1, ["tower-elevation.pdf"]),
    bucket("video", {}, null, `${DELIVERY}\\video`, [CLIP], 1, ["walkround.mp4"]),
  ],
  not_recognised: { count: 1, samples: [{ name: "Thumbs.db", reason: "unknown type" }] },
  suggested_template_id: null,
  truncated: false,
};

const inspection = (state: "inspecting" | "ready") => ({
  id: INSPECTION,
  state,
  error: null,
  job_id: "j-setup-read-drawing",
  path: PLAN,
  format: "pdf",
  file_size: 120_000,
  sha256: null,
  units: null,
  units_source: null,
  crs_hint: null,
  extent_src: null,
  layers: [],
  page_count: 1,
  pages: [{ page: 1, width_pt: 1191, height_pt: 842 }],
  width: null,
  height: null,
  embedded: null,
  warnings: [],
  created_at: T,
});

interface World {
  ensureBodies: Json[];
  projectBody: Json | null;
  posted: { path: string; body: Json }[];
}

async function serveSetup(page: Page, opts: { failSourcesOnce?: boolean } = {}): Promise<World> {
  const example = await fromMock<Json>(page, `/api/v1/projects/${EXAMPLE_P}`);
  const w: World = { ensureBodies: [], projectBody: null, posted: [] };
  const job = (id: string, type: string, state = "queued", projectId = P) =>
    libraryJob({ id, project_id: projectId, type, state, log_path: `runs/${id}/job.log`, created_at: T });
  const project = () => ({
    ...example,
    id: P,
    name: w.projectBody?.name,
    folder: w.projectBody?.folder,
    created_at: T,
    last_opened_at: T,
  });

  await page.route(
    (u) => u.pathname === "/api/v1/project-templates",
    (r) => (r.request().method() === "GET" ? r.fulfill(jsonReply({ items: [TEMPLATE] })) : r.fallback()),
  );
  await page.route(
    (u) => u.pathname === "/api/v1/catalogue/types/ensure",
    (r) => {
      const b = r.request().postDataJSON() as { types: Json[]; dry_run?: boolean };
      if (!b.dry_run) w.ensureBodies.push(b);
      return r.fulfill(
        jsonReply({
          items: b.types.map((t, i) => ({
            name: t.name,
            id: b.dry_run ? null : `t-setup-${i}`,
            created: !b.dry_run,
            conflict: null,
          })),
        }),
      );
    },
  );
  await page.route(
    (u) => u.pathname === "/api/v1/setup/inspect",
    (r) => r.fulfill(jsonReply({ job: job(INSPECT_JOB, "setup_inspect", "running", "library") }, 202)),
  );
  await page.route(
    (u) => u.pathname === `/api/v1/library/jobs/${INSPECT_JOB}`,
    (r) =>
      r.fulfill(
        jsonReply({
          ...job(INSPECT_JOB, "setup_inspect", "succeeded", "library"),
          progress: 1,
          result: INSPECT_RESULT,
          finished_at: T,
        }),
      ),
  );
  await page.route(
    (u) => u.pathname === "/api/v1/projects" || u.pathname.startsWith(`/api/v1/projects/${P}`),
    (r) => {
      const req = r.request();
      const method = req.method();
      const path = new URL(req.url()).pathname.replace(/^\/api\/v1/, "");
      const reply = (body: unknown, status = 200) => r.fulfill(jsonReply(body, status));
      if (path === "/projects" && method === "POST") {
        w.projectBody = req.postDataJSON() as Json;
        return reply(project(), 201);
      }
      if (path === "/projects") return r.fallback();
      const sub = path.slice(`/projects/${P}`.length);
      if (sub === "" && method === "GET") return reply(project());
      if (method === "POST") w.posted.push({ path: sub, body: req.postDataJSON() as Json });
      if (sub === "/sources" && method === "POST") {
        const failed = opts.failSourcesOnce && w.posted.filter((x) => x.path === "/sources").length === 1;
        if (failed)
          return reply(
            {
              error: {
                code: "job_running",
                message: "an import of this folder is already running",
                details: {},
              },
            },
            409,
          );
        return reply(
          { source: { id: "s-setup", folder: PHOTOS }, job: job("j-setup-import", "import") },
          202,
        );
      }
      if (sub === "/drawing-inspections" && method === "POST")
        return reply(
          {
            inspection: inspection("inspecting"),
            job: job("j-setup-read-drawing", "drawing_import", "running"),
          },
          202,
        );
      if (sub === `/drawing-inspections/${INSPECTION}`) return reply(inspection("ready"));
      if (sub === "/drawings" && method === "POST")
        return reply(
          {
            drawing: { id: "d-setup", name: "tower-elevation", status: "importing" },
            job: job("j-setup-drawing", "drawing_import"),
          },
          202,
        );
      return r.fallback();
    },
  );
  return w;
}

async function setUp(page: Page) {
  await page.goto("/projects");
  await setupUi.newProject(page).click();
  await expect(page).toHaveURL(/\/projects\/new$/);
  await setupUi.template(page, "Vertical asset inspection").click();
  await setupUi.name(page).fill("Tower 14");
  await setupUi.folder(page).fill(FOLDER);
  await sortFolder(page, DELIVERY);
  await expect(setupUi.slot(page, "Visual photos")).toContainText("2");
  await expect(setupUi.slot(page, "Thermal photos")).toContainText("2");
  await expect(setupUi.slot(page, "Asset drawings")).toContainText("1");
}

test("setup journey: vertical template, visual and thermal in one folder, Create starts every import once", async ({
  page,
}) => {
  const w = await serveSetup(page);
  await setUp(page);
  await expect(setupUi.sharedFolderNote(page)).toBeVisible();
  if (process.env.E2E_CAPTURE_EVIDENCE === "1")
    await setupUi.slot(page, "Visual photos").evaluate((el) => el.scrollIntoView({ block: "center" }));
  await entrancesDone(page);
  await page.screenshot({ path: evidencePath("setup", "setup-sorted.png") });

  // The response, not the request: the fake records the POST in its route handler, which runs after
  // the request event fires, so only the response proves the build request is in `w.posted`.
  const built = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith(`/projects/${P}/drawings`),
  );
  await setupUi.create(page).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/overview$`));
  await built;

  expect(w.ensureBodies).toHaveLength(1);
  const specs = w.ensureBodies[0].types as Json[];
  expect(specs.map((t) => t.name)).toEqual(VERTICAL_TYPES.map(([name]) => name));
  for (const t of specs)
    expect(Object.keys(t).sort()).toEqual([
      "colour",
      "default_severity",
      "definition",
      "hotkey",
      "kind",
      "name",
      "severity_rules",
    ]);
  expect(w.projectBody).toEqual({
    name: "Tower 14",
    folder: FOLDER,
    type_ids: VERTICAL_TYPES.map((_, i) => `t-setup-${i}`),
    hotkeys: Object.fromEntries(VERTICAL_TYPES.map(([, , , hotkey], i) => [`t-setup-${i}`, hotkey])),
  });
  expect(w.posted).toEqual([
    { path: "/sources", body: { folder: PHOTOS } },
    { path: "/drawing-inspections", body: { path: PLAN } },
    {
      path: "/drawings",
      body: {
        inspection_id: INSPECTION,
        name: "tower-elevation",
        placement: { method: "none" },
        page: 1,
        dpi: 150,
      },
    },
  ]);
  expect(JSON.stringify(w.posted)).not.toContain("walkround");
  // The Overview must have rendered, or a missing notice would prove nothing.
  await expect(page.getByTestId("overview-grid")).toBeVisible();
  await expect(setupUi.notice(page)).toHaveCount(0);
  await entrancesDone(page);
  await page.screenshot({ path: evidencePath("setup", "overview-after-create.png"), fullPage: true });
});

test("a failed import shows on the Overview, and Retry starts it once", async ({ page }) => {
  const w = await serveSetup(page, { failSourcesOnce: true });
  await setUp(page);
  await setupUi.create(page).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/overview$`));
  const notice = setupUi.notice(page);
  await expect(notice).toContainText("Setup: 1 import failed");
  await expect(notice).toContainText("Visual photos");
  await expect(notice).toContainText("Thermal photos");
  await expect(notice).toContainText("an import of this folder is already running");
  await entrancesDone(page);
  await page.screenshot({ path: evidencePath("setup", "setup-notice-failed.png"), fullPage: true });

  const retried = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith(`/projects/${P}/sources`),
  );
  await notice.getByRole("button", { name: "Retry Visual photos" }).click();
  expect((await retried).status()).toBe(202);
  await expect(notice).toHaveCount(0);
  expect(w.posted.filter((x) => x.path === "/sources")).toHaveLength(2);
});
