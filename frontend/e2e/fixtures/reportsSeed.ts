import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type APIRequestContext } from "@playwright/test";

// Seeds real projects for the Reports real-backend flows through the public API (plan
// 2026-09-30-reports-r10, Task 2). Every run writes under a fresh folder, so a second run against
// the same scratch data folder never collides with the first.

export const API = `http://127.0.0.1:${process.env.E2E_API_PORT}/api/v1`;
export const auth = { Authorization: `Bearer ${process.env.E2E_API_TOKEN}` };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;
type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export async function api<T = Json>(
  request: APIRequestContext,
  method: Method,
  path: string,
  data?: unknown,
  ok: number[] = [200, 201, 202, 204],
): Promise<T> {
  const r = await request.fetch(`${API}${path}`, { method, headers: auth, data });
  const text = await r.text();
  expect(ok, `${method} ${path} answered ${r.status()}: ${text}`).toContain(r.status());
  return (text ? JSON.parse(text) : {}) as T;
}

/** Polls a job until it is terminal, then requires `succeeded` (the job's error in the message). */
export async function waitJob(
  request: APIRequestContext,
  pid: string,
  jobId: string,
  timeoutMs = 180_000,
): Promise<Json> {
  let job: Json = {};
  await expect
    .poll(
      async () => {
        job = await api(request, "GET", `/projects/${pid}/jobs/${jobId}`);
        return job.state as string;
      },
      { timeout: timeoutMs, intervals: [250, 500, 1000] },
    )
    .toMatch(/^(succeeded|failed|cancelled)$/);
  expect(job.state, `job ${jobId}: ${JSON.stringify(job.error ?? job)}`).toBe("succeeded");
  return job;
}

/** A catalogue type's id: created, or the existing one on 409 `type_exists` (a re-run). */
export async function catalogueType(
  request: APIRequestContext,
  name: string,
  kind: "defect" | "object",
  defaultSeverity: number | null,
): Promise<string> {
  const r = await request.post(`${API}/catalogue/types`, {
    headers: auth,
    data: { name, kind, default_severity: defaultSeverity },
  });
  const body = (await r.json()) as Json;
  if (r.status() === 201) return body.id as string;
  expect(r.status(), JSON.stringify(body)).toBe(409);
  expect(body.error.code).toBe("type_exists");
  return body.error.details.type_id as string;
}

export interface Data {
  photos: string;
  orthos: [string, string];
  ortho_origin: [number, number];
  ortho_epsg: number;
  cloud: string;
  cloud_origin: [number, number, number];
  attachment: string;
  image_size: [number, number];
}

/** A fresh run folder and the inputs Task 1's script writes into it. */
export function makeData(images = 2, size = "1600x1200"): { root: string; data: Data } {
  const root = join(process.env.E2E_DATA_DIR!, `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  mkdirSync(root, { recursive: true });
  const out = execFileSync(
    process.env.KESTREL_PYTHON!,
    [
      "scripts/make_reports_e2e_data.py",
      join(root, "data"),
      "--images",
      String(images),
      "--image-size",
      size,
    ],
    { cwd: "../backend" },
  ).toString();
  return { root, data: JSON.parse(out.trim().split("\n").pop()!) as Data };
}

export interface Seeded {
  pid: string;
  /** The project folder (absolute): version folders and export folders are relative to it. */
  folder: string;
  typeIds: string[];
  imageId: string;
  mapIds: [string, string];
  cloudId: string;
  findings: { image: string; map: string; cloud: string };
}

export async function createProjectWithTypes(
  request: APIRequestContext,
  name: string,
  typeIds: string[],
  folder?: string,
): Promise<string> {
  const target =
    folder ??
    join(process.env.E2E_DATA_DIR!, `project-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const project = await api(request, "POST", "/projects", { name, folder: target, type_ids: typeIds }, [201]);
  return project.id as string;
}

/**
 * Spec §17 flow 1's seeded project: two photos, two dated orthos (Aug, Sep), one point cloud; an
 * image finding (Crack, Moderate, with a site photo), a map finding (Spalling, Major) and a cloud
 * finding (Corrosion, Minor); one map distance for the Measurements section.
 */
export async function seedInspectionProject(request: APIRequestContext, name: string): Promise<Seeded> {
  const { root, data } = makeData();
  const crack = await catalogueType(request, "Crack", "defect", 2);
  const spalling = await catalogueType(request, "Spalling", "defect", 3);
  const corrosion = await catalogueType(request, "Corrosion", "defect", 1);
  const typeIds = [crack, spalling, corrosion];
  const folder = join(root, "project");
  const pid = await createProjectWithTypes(request, name, typeIds, folder);

  const source = await api(
    request,
    "POST",
    `/projects/${pid}/sources`,
    { folder: data.photos, site: "north-yard" },
    [202],
  );
  await waitJob(request, pid, source.job.id);
  const images = await api(request, "GET", `/projects/${pid}/images?limit=10&sort=path`);
  const imageId = images.items[0].id as string;

  const mapIds: string[] = [];
  for (const [path, date] of [
    [data.orthos[0], "2026-08-14"],
    [data.orthos[1], "2026-09-14"],
  ] as const) {
    const created = await api(request, "POST", `/projects/${pid}/maps`, { path }, [202]);
    await waitJob(request, pid, created.job.id);
    await api(request, "PATCH", `/projects/${pid}/maps/${created.map.id}`, { captured_on: date });
    mapIds.push(created.map.id as string);
  }

  const cloud = await api(request, "POST", `/projects/${pid}/pointclouds`, { path: data.cloud }, [202]);
  await waitJob(request, pid, cloud.job.id, 240_000);
  const cloudId = cloud.cloud.id as string;

  const [e0, n0] = data.ortho_origin;
  const [cx, cy] = data.cloud_origin;
  const image = await api(
    request,
    "POST",
    `/projects/${pid}/findings`,
    {
      type_id: crack,
      severity: 2,
      note: "Crack along the north parapet.",
      anchor: { kind: "image", image_id: imageId, box: { x: 700, y: 560, w: 200, h: 80 } },
    },
    [201],
  );
  await api(
    request,
    "POST",
    `/projects/${pid}/findings/${image.id}/attachments`,
    { path: data.attachment },
    [201],
  );
  const map = await api(
    request,
    "POST",
    `/projects/${pid}/findings`,
    {
      type_id: spalling,
      severity: 3,
      anchor: {
        kind: "map",
        map_id: mapIds[1],
        geometry: { type: "Point", coordinates: [e0 + 50, n0 - 50] },
      },
    },
    [201],
  );
  const cloudFinding = await api(
    request,
    "POST",
    `/projects/${pid}/findings`,
    {
      type_id: corrosion,
      severity: 1,
      anchor: { kind: "cloud", cloud_id: cloudId, x: cx + 50, y: cy + 50, z: 5, uncertainty_m: 0.05 },
    },
    [201],
  );
  // A map measurement needs the project's site frame, which the Maps workspace creates on first open.
  await api(request, "PUT", `/projects/${pid}/map-workspace/frame`, { kind: "crs", epsg: data.ortho_epsg });
  await api(
    request,
    "POST",
    `/projects/${pid}/map-measurements`,
    {
      kind: "distance",
      vertices: [
        [e0 + 40, n0 - 30],
        [e0 + 70, n0 - 70],
      ],
      map_id: mapIds[1],
    },
    [201],
  );

  return {
    pid,
    folder,
    typeIds,
    imageId,
    mapIds: [mapIds[0], mapIds[1]],
    cloudId,
    findings: { image: image.id, map: map.id, cloud: cloudFinding.id },
  };
}

/** §18 criterion 4: `n` Crack findings, ten per 4000x3000 photo, severities cycling 1-4. */
export async function seedScaleProject(
  request: APIRequestContext,
  n: number,
): Promise<{ pid: string; folder: string }> {
  const perImage = 10;
  const { root, data } = makeData(Math.ceil(n / perImage), "4000x3000");
  const crack = await catalogueType(request, "Crack", "defect", 2);
  const folder = join(root, "project");
  const pid = await createProjectWithTypes(request, "Reports scale", [crack], folder);
  const source = await api(
    request,
    "POST",
    `/projects/${pid}/sources`,
    { folder: data.photos, site: "scale" },
    [202],
  );
  await waitJob(request, pid, source.job.id, 300_000);
  const images = await api(
    request,
    "GET",
    `/projects/${pid}/images?limit=${Math.ceil(n / perImage)}&sort=path`,
  );
  let made = 0;
  for (const img of images.items as Json[]) {
    for (let k = 0; k < perImage && made < n; k++, made++) {
      await api(
        request,
        "POST",
        `/projects/${pid}/findings`,
        {
          type_id: crack,
          severity: 1 + (k % 4),
          anchor: {
            kind: "image",
            image_id: img.id,
            box: { x: 200 + 350 * k, y: 400 + 600 * (k % 3), w: 180, h: 90 },
          },
        },
        [201],
      );
    }
  }
  expect(made).toBe(n);
  return { pid, folder };
}
