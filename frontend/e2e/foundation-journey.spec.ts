import { test, expect, type Page, type Request, type Route } from "@playwright/test";
import { CATALOGUE_PAGE, SEVERITY, libraryJob } from "./fixtures/appSections";
import { fromMock, jsonReply } from "./mock";

// Unit X (foundation index, Step 2): one journey across the merged Foundation units. The routes
// below are a small stateful backend: each step reads what the previous step wrote (the created
// project is listed and opened, the type list set in settings is the editor's and the Findings
// tab's, the accepted detection is the finding, its severity is what Findings and the Overview show,
// the dataset built in Models is what the training form offers). Anything not faked here (library
// models, image files, thumbnails) comes from the Prism mock.

/** The contract's Project example, the base of the created project and the one already listed. */
const EXAMPLE_P = "7f1c2e3a-1111-4000-8000-000000000001";
/** The created project gets its own id, so every later read proves the app follows the POST's answer. */
const P = "7f1c2e3a-1111-4000-8000-0000000000f1";
const SOURCE = "50000000-3333-4000-8000-0000000000f1";
const IMPORT_JOB = "j0000000-4444-4000-8000-0000000000f1";
const IMG = "10000000-5555-4000-8000-000000000001";
const BOX = "b0000000-6666-4000-8000-0000000000f1";
const FINDING = "f0000000-1212-4000-8000-0000000000f1";
const DATASET = "d-lib-f1";
const MODEL = "m0000000-2222-4000-8000-000000000001";
const FOLDER = "E:\\Projects\\Tower-Q3";
const PHOTOS = "E:\\Surveys\\Tower-Q3 flight 1";
const T = "2026-09-27T09:00:00Z";
const CRACK = CATALOGUE_PAGE.items.find((t) => t.name === "Crack")!;
const EXCAVATOR = CATALOGUE_PAGE.items.find((t) => t.name === "Excavator")!;
const EMPTY_PAGE = { items: [], next_cursor: null };

type Json = Record<string, unknown>;

/** The fake backend's state: what each step wrote, for the next step's reads. */
interface World {
  project: Json | null;
  typeIds: string[];
  imported: boolean;
  boxState: "unreviewed" | "accepted";
  finding: Json | null;
  dataset: Json | null;
}

async function serveBackend(page: Page): Promise<World> {
  const exampleProject = await fromMock(page, `/api/v1/projects/${EXAMPLE_P}`);
  const imagePage = await fromMock<{ items: Json[] }>(page, `/api/v1/projects/${EXAMPLE_P}/images`);
  const sourcePage = await fromMock<{ items: Json[] }>(page, `/api/v1/projects/${EXAMPLE_P}/sources`);
  const jobPage = await fromMock<{ items: Json[] }>(page, `/api/v1/projects/${EXAMPLE_P}/jobs`);
  const world: World = {
    project: null,
    typeIds: [],
    imported: false,
    boxState: "unreviewed",
    finding: null,
    dataset: null,
  };

  const classes = () =>
    world.typeIds.map((id, order) => {
      const { name, colour, kind, default_severity, hotkey, group } = CATALOGUE_PAGE.items.find(
        (x) => x.id === id,
      )!;
      return { id, name, colour, hotkey, order, kind, default_severity, group };
    });
  const openFindings = () => (world.finding && world.finding.status === "open" ? [world.finding] : []);
  const image = () => ({
    ...imagePage.items[0],
    id: IMG,
    source_id: SOURCE,
    box_count: 1,
    pending_count: world.boxState === "unreviewed" ? 1 : 0,
    max_pending_confidence: world.boxState === "unreviewed" ? 0.87 : null,
    labeled: world.boxState === "accepted",
  });
  const projectJson = () => ({
    ...world.project,
    classes: classes(),
    summary: {
      image_count: world.imported ? 1 : 0,
      maps: 0,
      point_clouds: 0,
      elevations: 0,
      open_findings: openFindings().length,
      open_top_severity: openFindings().filter((f) => f.severity === 4).length,
      cover: world.imported ? { kind: "image", id: IMG } : null,
    },
  });
  const source = () => ({
    ...sourcePage.items[0],
    id: SOURCE,
    label: "Tower-Q3 flight 1",
    folder: PHOTOS,
    site: "tower-q3",
    image_count: world.imported ? 1 : 0,
    duplicate_count: 0,
    job_id: IMPORT_JOB,
    imported_at: world.imported ? T : null,
    created_at: T,
  });
  // The import finished by the time anything reads it back (the mock has no events socket).
  const importJob = (state: "queued" | "succeeded") => ({
    ...jobPage.items[0],
    id: IMPORT_JOB,
    project_id: P,
    project_name: "Tower Q3",
    type: "import",
    state,
    progress: state === "succeeded" ? 1 : 0,
    message: state === "succeeded" ? "1 / 1 images" : "",
    params: { folder: PHOTOS },
    result: null,
    error: null,
    created_at: T,
    started_at: T,
    finished_at: state === "succeeded" ? T : null,
  });
  const jobs = () => (world.imported ? [importJob("succeeded")] : []);
  const box = () => ({
    id: BOX,
    image_id: IMG,
    class_id: CRACK.id,
    x: 1210,
    y: 802,
    w: 160,
    h: 90,
    angle: 0,
    confidence: 0.87,
    provenance: {
      kind: "local_model",
      model_id: MODEL,
      provider: null,
      model_name: "yolo11m-coco",
      query_run_id: null,
    },
    review_state: world.boxState,
    reviewed_at: world.boxState === "accepted" ? T : null,
    created_at: T,
  });
  const summary = () => {
    const open = openFindings();
    const bySeverity: Record<string, number> = {};
    for (const s of SEVERITY) bySeverity[String(s.level)] = open.filter((f) => f.severity === s.level).length;
    return {
      by_status: {
        open: open.length,
        reviewed: world.finding?.status === "reviewed" ? 1 : 0,
        closed: world.finding?.status === "closed" ? 1 : 0,
      },
      open_by_severity: bySeverity,
      open_no_severity: open.filter((f) => f.severity === null).length,
      by_type: open.length ? [{ type_id: CRACK.id, n: open.length }] : [],
      trend: [],
    };
  };
  const detail = () => ({ ...world.finding, attachment_count: 0, comment_count: 0 });
  // The builder counts reviewed boxes only: the Crack box counts once it was accepted.
  const preview = () => {
    const n = world.boxState === "accepted" ? 1 : 0;
    return {
      images: n,
      boxes_per_type: { [CRACK.id]: n },
      projects: [{ project_id: P, project_name: "Tower Q3", images: n, boxes: n, state: "ok" }],
    };
  };

  const handle = (route: Route): Promise<void> => {
    const req = route.request();
    const method = req.method();
    const path = new URL(req.url()).pathname.replace(/^\/api\/v1/, "");
    const reply = (body: unknown, status = 200) => route.fulfill(jsonReply(body, status));
    const body = () => req.postDataJSON() as Json;

    // --- Projects (step 1)
    if (path === "/projects" && method === "GET")
      return reply({
        items: [{ ...exampleProject, migration: { state: "ok" } }, ...(world.project ? [projectJson()] : [])],
        next_cursor: null,
      });
    if (path === "/projects" && method === "POST") {
      const b = body();
      world.project = {
        ...exampleProject,
        id: P,
        name: b.name,
        folder: b.folder,
        preannotation_model_id: null,
        created_at: T,
        last_opened_at: T,
      };
      world.typeIds = (b.type_ids as string[]) ?? [];
      return reply(projectJson(), 201);
    }
    if (!path.startsWith(`/projects/${P}`)) return route.fallback();
    const sub = path.slice(`/projects/${P}`.length);
    if (sub === "" && method === "GET") return reply(projectJson());

    // --- Types (step 3)
    if (sub === "/types" && method === "PUT") {
      world.typeIds = body().type_ids as string[];
      return reply(projectJson());
    }

    // --- Add data: photos (step 2)
    if (sub === "/sources" && method === "POST") {
      world.imported = true;
      return reply({ source: source(), job: importJob("queued") }, 202);
    }
    if (sub === "/sources" && method === "GET")
      return reply({ items: world.imported ? [source()] : [], next_cursor: null });
    if (sub === "/jobs" && method === "GET") return reply({ items: jobs(), next_cursor: null });
    if (sub === `/jobs/${IMPORT_JOB}`) return reply(importJob("succeeded"));
    if (sub === "/data" && method === "GET")
      return reply({
        items: world.imported
          ? [
              {
                id: SOURCE,
                type: "image_set",
                label: "Tower-Q3 flight 1",
                captured_on: null,
                status: "ready",
                created_at: T,
                summary: { image_count: 1, duplicate_count: 0 },
              },
            ]
          : [],
        next_cursor: null,
      });
    if (sub === "/images" && method === "GET") {
      const q = new URL(req.url()).searchParams;
      const items = !world.imported
        ? []
        : q.get("has_pending") === "true" && world.boxState !== "unreviewed"
          ? []
          : [image()];
      return reply({ items, next_cursor: null, total: items.length });
    }
    if (sub === `/images/${IMG}` && method === "GET") return reply(image());
    if (sub === `/images/${IMG}/boxes` && method === "GET") return reply({ items: [box()] });

    // --- Accept the detection; the annotation-finding invariant creates the finding (step 4)
    if (sub === "/boxes/review" && method === "POST") {
      const b = body();
      if (b.action === "accept" && (b.box_ids as string[]).includes(BOX)) {
        world.boxState = "accepted";
        world.finding ??= {
          id: FINDING,
          number: 1,
          type_id: CRACK.id,
          severity: CRACK.default_severity,
          status: "open",
          note: "",
          created_by: `model:${MODEL}`,
          confidence: 0.87,
          anchor: { kind: "image", image_id: IMG, annotation_id: BOX },
          lon: imagePage.items[0].lon,
          lat: imagePage.items[0].lat,
          data_type: "image_set",
          data_id: SOURCE,
          created_at: T,
          updated_at: T,
          reviewed_at: null,
          closed_at: null,
        };
      }
      return reply({ updated: 1 });
    }

    // --- Findings, the Overview (steps 5, 6)
    if (sub === "/findings/summary") return reply(summary());
    if (sub === "/findings" && method === "GET") {
      const status = new URL(req.url()).searchParams.getAll("status");
      const items =
        world.finding && (status.length === 0 || status.includes(world.finding.status as string))
          ? [world.finding]
          : [];
      return reply({ items, next_cursor: null });
    }
    if (sub === `/findings/${FINDING}` && world.finding) {
      if (method === "PATCH")
        world.finding = { ...world.finding, ...body(), updated_at: "2026-09-27T09:05:00Z" };
      return reply(detail());
    }
    if (sub.startsWith(`/findings/${FINDING}/`) && method === "GET" && !sub.endsWith("/thumbnail"))
      return reply(EMPTY_PAGE);
    if (sub === "/activity") return reply(EMPTY_PAGE);
    if (sub === "/overview")
      return reply({
        findings: summary(),
        data: {
          image_sets: world.imported ? 1 : 0,
          images: world.imported ? 1 : 0,
          maps: 0,
          elevations: 0,
          point_clouds: 0,
          drawings: 0,
        },
        latest_volume: null,
        hero_map_id: null,
        banners: [],
      });
    return route.fallback();
  };

  await page.route((u) => u.pathname.startsWith("/api/v1/projects"), handle);

  // --- The catalogue and the severity scale every screen reads
  await page.route(
    (u) => u.pathname === "/api/v1/catalogue/types",
    (route) => route.fulfill(jsonReply({ ...CATALOGUE_PAGE, needs_classification: false })),
  );
  await page.route(
    (u) => u.pathname === "/api/v1/catalogue/severity",
    (route) => route.fulfill(jsonReply({ levels: SEVERITY })),
  );

  // --- App-wide jobs: the import (and nothing else) once it ran
  await page.route(
    (u) => u.pathname === "/api/v1/jobs" || u.pathname === "/api/v1/library/jobs",
    (route) => {
      const states = new URL(route.request().url()).searchParams.getAll("state");
      const all = new URL(route.request().url()).pathname === "/api/v1/jobs" ? jobs() : [];
      return route.fulfill(
        jsonReply({
          items: all.filter((j) => states.length === 0 || states.includes(j.state)),
          next_cursor: null,
        }),
      );
    },
  );

  // --- Models: datasets (step 7) and training (step 8)
  await page.route(
    (u) => u.pathname.startsWith("/api/v1/library/datasets"),
    (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      if (path === "/api/v1/library/datasets/preview") return route.fulfill(jsonReply(preview()));
      if (path === "/api/v1/library/datasets" && req.method() === "POST") {
        const b = req.postDataJSON() as Json;
        const filter = b.filter as Json;
        world.dataset = {
          id: DATASET,
          name: b.name,
          task: b.task,
          origin: "built",
          filter,
          classes: (filter.type_ids as string[]).map((id) => ({
            type_id: id,
            name: CATALOGUE_PAGE.items.find((t) => t.id === id)?.name,
          })),
          split_method: b.split_method,
          split_params: { val_fraction: b.val_fraction, seed: b.seed },
          // The build job is mocked done: every later read sees a ready dataset.
          state: "ready",
          counts: { images: 1, train: 1, val: 0, per_class: { [CRACK.id]: 1 } },
          export_path: null,
          export_state: "none",
          legacy_path: null,
          job_id: "j-build-f1",
          created_at: T,
          sources: [{ project_id: P, project_name: "Tower Q3", project_folder: FOLDER, image_count: 1 }],
        };
        return route.fulfill(
          jsonReply(
            {
              dataset: { ...world.dataset, state: "resolving" },
              job: libraryJob({ id: "j-build-f1", type: "dataset_build", params: { dataset_id: DATASET } }),
            },
            202,
          ),
        );
      }
      if (path === "/api/v1/library/datasets")
        return route.fulfill(jsonReply({ items: world.dataset ? [world.dataset] : [], next_cursor: null }));
      if (path === `/api/v1/library/datasets/${DATASET}/items`) return route.fulfill(jsonReply(EMPTY_PAGE));
      if (path === `/api/v1/library/datasets/${DATASET}` && world.dataset)
        return route.fulfill(jsonReply(world.dataset));
      return route.fallback();
    },
  );
  // The build job is done the first time the Datasets screen polls it.
  await page.route(
    (u) => u.pathname === "/api/v1/library/jobs/j-build-f1",
    (route) =>
      route.fulfill(
        jsonReply(
          libraryJob({
            id: "j-build-f1",
            type: "dataset_build",
            state: "succeeded",
            progress: 1,
            message: "1 images",
            params: { dataset_id: DATASET },
            result: { dataset_id: DATASET },
            started_at: T,
            finished_at: T,
          }),
        ),
      ),
  );
  await page.route(
    (u) => u.pathname.startsWith("/api/v1/library/training-runs"),
    (route) => {
      const req = route.request();
      if (req.method() === "POST") {
        const b = req.postDataJSON() as Json;
        const run = {
          id: "t-f1",
          name: b.name,
          dataset_id: b.dataset_id,
          base_model_id: b.base_model_id,
          params: b,
          job_id: "j-train-f1",
          state: "queued",
          model_id: null,
          metrics: null,
          created_at: T,
          finished_at: null,
        };
        return route.fulfill(
          jsonReply({ training_run: run, job: libraryJob({ id: "j-train-f1", type: "train" }) }, 202),
        );
      }
      return route.fulfill(jsonReply(EMPTY_PAGE));
    },
  );
  return world;
}

/**
 * Watches the API traffic of `page`. `settled()` waits until nothing is in flight and no request
 * started or ended for `quietMs`; `count()` runs an action and returns the GET requests the app
 * made from then until the page settled again (method + path + query, ids replaced by names). The
 * mock has no events socket, so these are the client's own re-reads after a write, not the reads a
 * `findings.changed` event would add.
 */
function apiTraffic(page: Page, quietMs = 1500) {
  const isApi = (r: Request) => new URL(r.url()).pathname.startsWith("/api/v1/");
  const inFlight = new Set<Request>();
  let last = Date.now();
  let reads: string[] | null = null;
  const named = (r: Request) => {
    const u = new URL(r.url());
    return `${r.method()} ${u.pathname.replace(/^\/api\/v1/, "")}${u.search}`
      .replaceAll(P, "{projectId}")
      .replaceAll(FINDING, "{findingId}");
  };
  page.on("request", (r) => {
    if (!isApi(r)) return;
    inFlight.add(r);
    last = Date.now();
    if (reads && r.method() === "GET") reads.push(named(r));
  });
  const done = (r: Request) => {
    if (!isApi(r)) return;
    inFlight.delete(r);
    last = Date.now();
  };
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  // A request the old document had open when it was reloaded never reports an end.
  page.on("domcontentloaded", () => inFlight.clear());
  const settled = () =>
    expect
      .poll(() => (Date.now() - last >= quietMs ? [...inFlight].map(named) : ["busy"]), {
        timeout: 15_000,
        intervals: [100],
      })
      .toEqual([]);
  return {
    settled,
    async count(action: () => Promise<void>): Promise<string[]> {
      reads = [];
      await action();
      await settled();
      const out = reads;
      reads = null;
      return out;
    },
  };
}

test("one project from creation to a training run: every Foundation unit reads what the last one wrote", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const world = await serveBackend(page);
  const traffic = apiTraffic(page);

  // 1. Create a project; it is listed and opens on its Overview.
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Name").fill("Tower Q3");
  await dialog.locator("#project-folder").fill(FOLDER);
  const created = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/api/v1/projects"));
  await dialog.getByRole("button", { name: "Create project" }).click();
  expect((await created).postDataJSON()).toMatchObject({ name: "Tower Q3", folder: FOLDER, type_ids: [] });
  await expect(page).toHaveURL(new RegExp(`/p/${P}/overview$`));
  await page.goto("/projects");
  await expect(page.getByRole("article", { name: "Tower Q3" })).toBeVisible();
  await page.getByRole("article", { name: "Tower Q3" }).getByRole("button", { name: "Open" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/overview$`));

  // 2. Add data: photos, through the importer; the import job is done when it is read back.
  await page.getByRole("button", { name: "Add data" }).first().click();
  await page
    .getByRole("dialog", { name: "Add data" })
    .getByRole("button", { name: /Photos/ })
    .click();
  const importer = page.getByRole("dialog", { name: "Import images" });
  await importer.getByLabel("Folder").fill(PHOTOS);
  await importer.getByLabel("Site name").fill("tower-q3");
  const imported = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith(`/projects/${P}/sources`),
  );
  await importer.getByRole("button", { name: "Start import" }).click();
  expect((await imported).postDataJSON()).toMatchObject({ folder: PHOTOS, site: "tower-q3" });
  await expect(page.getByText("Photos import started")).toBeVisible();
  await page.goto(`/jobs?state=finished&project=${P}`);
  const importRow = page.getByRole("row", { name: /Import/ });
  await expect(importRow).toContainText("Tower Q3");
  await expect(importRow).toContainText("1 / 1 images");

  // 3. Set the project's type list in Project settings.
  await page.goto(`/p/${P}/settings`);
  const types = page.getByRole("region", { name: "Types" });
  await types.getByLabel("Add type").fill("Crack");
  await types.getByRole("button", { name: "Add Crack" }).click();
  await types.getByLabel("Add type").fill("Excav");
  await types.getByRole("button", { name: "Add Excavator" }).click();
  const put = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith(`/projects/${P}/types`));
  await types.getByRole("button", { name: "Save types" }).click();
  expect((await put).postDataJSON()).toMatchObject({ type_ids: [CRACK.id, EXCAVATOR.id] });
  await expect(types.getByText("Types saved")).toBeVisible();
  await expect(types.getByRole("button", { name: "Save types" })).toBeDisabled();
  await page.reload();
  await expect(types.getByRole("listitem")).toHaveText([/^1\s*Crack/, /^2\s*Excavator/]);

  // 4. Accept the proposed Crack box on the imported photo; the backend makes it a finding.
  await page.goto(`/p/${P}/images`);
  await expect(page.getByRole("tab", { name: "Images 1" })).toBeVisible();
  await expect(page.getByText("1 of 1 images")).toBeVisible();
  await page.getByRole("button", { name: "Label next" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/images/${IMG}$`));
  await expect(page.getByTestId("proposal-count")).toHaveText("1 suggestion");
  const accepted = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/boxes/review"));
  await page.keyboard.press("a");
  expect((await accepted).postDataJSON()).toEqual({ box_ids: [BOX], action: "accept" });
  expect(world.finding).not.toBeNull();

  // 5. Set its severity in the Findings tab's inspector, and count the reads that edit costs.
  await page.goto(`/p/${P}/findings`);
  const row = page.getByRole("row", { name: /F-0001/ });
  await expect(row).toContainText("Crack");
  await expect(row).toContainText("Moderate");
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/findings/${FINDING}$`));
  const picker = page.getByRole("radiogroup", { name: "Severity" });
  await expect(picker.getByRole("radio", { name: "2 Moderate" })).toHaveAttribute("aria-checked", "true");
  // Let the inspector's own first reads finish, so only the edit's re-reads are counted.
  await traffic.settled();
  const patched = page.waitForRequest(
    (r) => r.method() === "PATCH" && r.url().endsWith(`/findings/${FINDING}`),
  );
  const reads = await traffic.count(() => picker.getByRole("radio", { name: "3 Major" }).click());
  expect((await patched).postDataJSON()).toEqual({ severity: 3 });
  await test
    .info()
    .attach("reads-per-finding-edit.txt", { body: reads.join("\n"), contentType: "text/plain" });
  // A regression guard, not an exact match. Measured 2026-09-27 (docs/evidence/foundation/README.md),
  // 5 reads, stable over repeated runs, no events socket in the mock:
  //   GET /projects/{projectId}/overview                                (tab counts)
  //   GET /projects/{projectId}/activity?subject_id={findingId}&limit=20 (inspector History)
  //   GET /projects/{projectId}/findings/{findingId}                    (inspector detail)
  //   GET /projects/{projectId}/findings/summary                        (filter counts)
  //   GET /projects/{projectId}/findings?sort=-severity&limit=200       (the list, re-read)
  expect(reads.length, reads.join("\n")).toBeLessThanOrEqual(5);

  // 6. Findings and the Overview show it at its new severity.
  await expect(picker.getByRole("radio", { name: "3 Major" })).toHaveAttribute("aria-checked", "true");
  await expect(row).toContainText("Major");
  await expect(page.getByRole("tab", { name: "Findings 1" })).toBeVisible();
  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/overview$`));
  await expect(page.getByRole("link", { name: "Major: 1 open" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Moderate: 0 open" })).toBeVisible();

  // 7. Build a dataset in Models from this project's Crack boxes.
  await page.goto("/models/datasets");
  await page.getByRole("link", { name: "New dataset" }).first().click();
  const builder = page.getByRole("form", { name: "New dataset" });
  await builder.getByLabel("Name", { exact: true }).fill("tower-cracks-v1");
  await builder.getByLabel("Tower Q3").check();
  await builder.getByLabel("Crack").check();
  await expect(builder.getByTestId("preview-images")).toHaveText("1");
  const built = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/library/datasets"));
  await builder.getByRole("button", { name: "Create dataset" }).click();
  expect((await built).postDataJSON()).toMatchObject({
    name: "tower-cracks-v1",
    filter: { project_ids: [P], type_ids: [CRACK.id] },
  });
  await expect(page).toHaveURL(new RegExp(`/models/datasets/${DATASET}$`));

  // 8. The training form offers that dataset and starts a run on it.
  await page.getByRole("link", { name: "Train on this dataset" }).click();
  await expect(page.getByRole("heading", { name: "New training run" })).toBeVisible();
  await expect(page.getByLabel("Dataset")).toHaveValue(DATASET);
  const start = page.getByRole("button", { name: "Start training" });
  await expect(start).toBeEnabled();
  const trained = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/library/training-runs"),
  );
  await start.click();
  expect((await trained).postDataJSON()).toMatchObject({ dataset_id: DATASET });
});
