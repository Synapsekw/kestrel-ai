import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type APIRequestContext } from "@playwright/test";

// Asset findings close-out X, step 1: the synthetic tower end to end on the real backend. Photos,
// GLB, poses from EXIF, three boxes of one defect on two photos, placement and grouping into ONE
// finding in the truth's zone and side, the finding open in the inspect screen, and a "White label"
// PDF. Skipped in the gate; playwright.real-backend.config.ts sets E2E_REAL_BACKEND.
test.skip(process.env.E2E_REAL_BACKEND !== "1", "opt-in: -c playwright.real-backend.config.ts");

const API = `http://127.0.0.1:${process.env.E2E_API_PORT}/api/v1`;
const auth = { Authorization: `Bearer ${process.env.E2E_API_TOKEN}` };
// D5, galvanising breakdown on the lower leg: a blob 0.66 m tall, so both halves of its truth box
// still land on it, and it is seen from the whole lowest ring of photos.
const DEFECT = "D5";

type Box = [number, number, number, number];
type TowerData = {
  photos: string;
  glb: string;
  frame: Record<string, unknown>;
  profile_id: string;
  truth: { id: string; zone: string; side: string; sightings: { image_name: string; box: Box }[] }[];
};
type Job = { id: string; state: string; error: string | null; result: Record<string, unknown> | null };
type Finding = {
  id: string;
  number: number;
  status: string;
  sighting_count: number;
  zone: string | null;
  side: string | null;
  placement: string | null;
};

async function waitJob(request: APIRequestContext, pid: string, jid: string): Promise<Job> {
  let job: Job | undefined;
  await expect
    .poll(
      async () => {
        job = (await (
          await request.get(`${API}/projects/${pid}/jobs/${jid}`, { headers: auth })
        ).json()) as Job;
        if (job.state === "failed" || job.state === "cancelled") throw new Error(`job ${jid}: ${job.error}`);
        return job.state;
      },
      { timeout: 120_000, intervals: [500] },
    )
    .toBe("succeeded");
  return job!;
}

async function post(request: APIRequestContext, url: string, data: unknown, status: number) {
  const r = await request.post(`${API}${url}`, { headers: auth, data });
  expect(r.status(), await r.text()).toBe(status);
  return r.json();
}

test("real backend: three boxes on the synthetic tower group into one finding and print", async ({
  page,
  request,
}) => {
  const root = join(process.env.E2E_DATA_DIR!, `tower-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  // 1. The synthetic tower, generated at run time.
  const data = JSON.parse(
    execFileSync(
      process.env.KESTREL_PYTHON!,
      ["scripts/make_asset_findings_e2e_data.py", join(root, "data")],
      {
        cwd: "../backend",
      },
    ).toString(),
  ) as TowerData;
  const projectFolder = join(root, "project");
  const { id: pid } = (await post(
    request,
    "/projects",
    { name: "Tower e2e", folder: projectFolder },
    201,
  )) as {
    id: string;
  };

  // 2. The photos. Threshold 0: the default near-duplicate filter drops 7 of the 32 look-alikes.
  const imported = (await post(
    request,
    `/projects/${pid}/sources`,
    { folder: data.photos, site: "Tower", settings: { dedupe_threshold: 0 } },
    202,
  )) as { job: { id: string } };
  await waitJob(request, pid, imported.job.id);
  const page1 = (await (
    await request.get(`${API}/projects/${pid}/images?limit=100`, { headers: auth })
  ).json()) as { items: { id: string; file_name: string }[] };
  // The import lowercases the extension (DJI_0001.JPG is stored as DJI_0001.jpg).
  const imageId = new Map(page1.items.map((i) => [i.file_name.toLowerCase(), i.id]));
  expect(imageId.size).toBeGreaterThanOrEqual(24);

  // 3. The GLB into an asset model, then the tower's frame and the telecom tower profile.
  const model = (await post(request, `/projects/${pid}/asset-models`, { name: "Synthetic tower" }, 201)) as {
    id: string;
  };
  const M = `/projects/${pid}/asset-models/${model.id}`;
  const glb = (await post(request, `${M}/versions/import-glb`, { path: data.glb }, 202)) as {
    job: { id: string };
  };
  await waitJob(request, pid, glb.job.id);
  const patched = await request.patch(`${API}${M}`, {
    headers: auth,
    data: { frame: data.frame, review: { profile_id: data.profile_id } },
  });
  expect(patched.status(), await patched.text()).toBe(200);

  // 4. Poses from each photo's GPS and gimbal.
  const pose = (await post(request, `${M}/poses/estimate`, {}, 202)) as { job: { id: string } };
  const posed = await waitJob(request, pid, pose.job.id);
  expect(posed.result?.estimated).toBe(imageId.size);

  // 5. One defect type; two boxes on photo A (the truth box split into its top and bottom halves)
  // and its whole truth box on photo B, each drawn as its own asset finding through the API.
  const type = (await post(
    request,
    "/catalogue/types",
    { name: `Tower coating ${Date.now()}`, kind: "defect", default_severity: 2 },
    201,
  )) as { id: string };
  const project = (await (await request.get(`${API}/projects/${pid}`, { headers: auth })).json()) as {
    classes: { id: string }[];
  };
  const typed = await request.put(`${API}/projects/${pid}/types`, {
    headers: auth,
    data: { type_ids: [...project.classes.map((c) => c.id), type.id] },
  });
  expect(typed.status(), await typed.text()).toBe(200);
  const truth = data.truth.find((t) => t.id === DEFECT)!;
  const seen = truth.sightings.filter((s) => imageId.has(s.image_name.toLowerCase()));
  expect(seen.length, `${DEFECT} needs two imported photos`).toBeGreaterThanOrEqual(2);
  const [[x, y, w, h], whole] = [seen[0].box, seen[1].box];
  const boxes: [string, Box][] = [
    [seen[0].image_name, [x, y, w, h / 2]],
    [seen[0].image_name, [x, y + h / 2, w, h / 2]],
    [seen[1].image_name, whole],
  ];
  for (const [name, [bx, by, bw, bh]] of boxes) {
    await post(
      request,
      `/projects/${pid}/findings`,
      {
        type_id: type.id,
        anchor: {
          kind: "asset",
          asset_model_id: model.id,
          sightings: [{ image_id: imageId.get(name.toLowerCase()), box: { x: bx, y: by, w: bw, h: bh } }],
        },
      },
      201,
    );
  }

  // 6. Placement, then the grouping job it queues (or a Regroup when it queued none).
  const place = (await post(request, `${M}/placements/compute`, {}, 202)) as { job: { id: string } };
  const placed = await waitJob(request, pid, place.job.id);
  expect(placed.result?.none).toBe(0);
  const groupJobId =
    (placed.result?.group_job_id as string | null) ??
    ((await post(request, `${M}/findings/regroup`, {}, 202)) as { job: { id: string } }).job.id;
  const grouped = await waitJob(request, pid, groupJobId);
  expect(grouped.result?.merged).toBe(2);

  // 7. Exactly one live finding with the three sightings, in the truth's zone and side.
  const all = (await (
    await request.get(`${API}/projects/${pid}/findings?asset_model_id=${model.id}`, { headers: auth })
  ).json()) as { items: Finding[] };
  const live = all.items.filter((f) => f.status !== "closed");
  expect(live).toHaveLength(1);
  const [finding] = live;
  expect(finding.sighting_count).toBe(3);
  expect([finding.zone, finding.side]).toEqual([truth.zone, truth.side]);
  const sightings = (await (
    await request.get(`${API}/projects/${pid}/findings/${finding.id}/sightings`, { headers: auth })
  ).json()) as { items: { image_id: string }[] };
  expect(sightings.items).toHaveLength(3);
  expect(new Set(sightings.items.map((s) => s.image_id)).size).toBe(2);

  const number = `F-${String(finding.number).padStart(4, "0")}`;
  await page.goto(`/p/${pid}/models/${model.id}/inspect?finding=${finding.id}`);
  const hud = page.getByTestId("inspect-hud");
  await expect(hud).toContainText(number);
  await expect(hud).toContainText("Sighting 1 of 3");
  await expect(hud).toContainText("Northwest");

  // 8. A report in the built-in "White label" brand.
  const brands = (await (await request.get(`${API}/brands`, { headers: auth })).json()) as {
    items: { id: string; name: string; builtin: boolean }[];
  };
  const brand = brands.items.find((b) => b.builtin && b.name === "White label");
  expect(brand, "the built-in White label brand").toBeTruthy();
  const report = (await post(request, `/projects/${pid}/reports`, { title: "Tower inspection" }, 201)) as {
    id: string;
    config: Record<string, unknown>;
  };
  const branded = await request.patch(`${API}/projects/${pid}/reports/${report.id}`, {
    headers: auth,
    data: { config: { ...report.config, brand_id: brand!.id } },
  });
  expect(branded.status(), await branded.text()).toBe(200);
  const render = (await post(
    request,
    `/projects/${pid}/reports/${report.id}/renders`,
    { formats: ["pdf"] },
    202,
  )) as {
    job: { id: string };
  };
  const rendered = await waitJob(request, pid, render.job.id);
  const version = (await (
    await request.get(`${API}/projects/${pid}/reports/${report.id}/versions/${rendered.result?.number}`, {
      headers: auth,
    })
  ).json()) as {
    folder: string;
    config: { brand_id: string | null };
    files: { name: string; kind: string }[];
    stats: { warnings: { code: string }[] };
  };
  expect(version.config.brand_id).toBe(brand!.id);
  expect(version.stats.warnings.map((w) => w.code)).not.toContain("brand_missing");

  // 9. The PDF is on disk with at least three pages.
  const pdf = version.files.find((f) => f.kind === "pdf");
  expect(pdf, "a PDF file in the version").toBeTruthy();
  const pdfPath = join(projectFolder, version.folder, pdf!.name);
  expect(existsSync(pdfPath)).toBe(true);
  const bytes = readFileSync(pdfPath);
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  const pages = (bytes.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
  expect(pages).toBeGreaterThanOrEqual(3);
});
