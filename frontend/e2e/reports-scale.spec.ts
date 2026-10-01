import { test, expect } from "@playwright/test";
import { measureFrames } from "./frameTime";
import { api, seedScaleProject, waitJob } from "./fixtures/reportsSeed";
import { openBuilder, renderFromBuilder, ui } from "./fixtures/reportsUi";

// Spec 2026-09-26-reports §18 criterion 4, the UI half (plan 2026-09-30-reports-r10, ruling R10-5): the
// builder stays responsive while a 300-finding report renders. A frame budget, so it runs only with
// E2E_FRAME_BUDGET=1 on the dev machine (playwright.reports.config.ts sets metadata.frameBudget);
// the memory half is backend/tests/test_reports_render_scale.py (-m perf).
test.skip(process.env.E2E_REPORTS_BACKEND !== "1", "opt-in: pnpm -C frontend e2e:reports");

const N = 300;
const FRAME_BUDGET_MS = 33.4; // p95, 30 fps, as images-map-scale.spec.ts

test("300 findings: the builder keeps its frame budget while the render job runs", async ({
  page,
  request,
}) => {
  test.skip(!test.info().config.metadata.frameBudget, "timing: E2E_FRAME_BUDGET=1");
  // Seeding 30 4000x3000 photos and 300 findings, then a render with a 900 s stall guard: more than
  // the config's 300 s per test.
  test.setTimeout(20 * 60_000);
  const { pid } = await seedScaleProject(request, N);
  const report = await api(
    request,
    "POST",
    `/projects/${pid}/reports`,
    { title: "Scale", template_id: "builtin-full" },
    [201],
  );
  const rid = report.id as string;
  await openBuilder(page, pid, rid);

  const job = await renderFromBuilder(page, rid, ["pdf"]);
  // The render is ~36 s; poll tightly so the 3 s sample starts as soon as the job is running.
  await expect
    .poll(async () => (await api(request, "GET", `/projects/${pid}/jobs/${job.id}`)).state as string, {
      intervals: [100],
    })
    .toBe("running");

  const preview = ui.preview(page);
  await preview.hover();
  const frames = measureFrames(page, { durationMs: 3000 });
  for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 600);
  const stats = await frames;
  const state = (await api(request, "GET", `/projects/${pid}/jobs/${job.id}`)).state as string;
  console.log(
    `scale: frames while rendering ${JSON.stringify(stats)}, job ${state} at the end of the sample`,
  );
  expect(state, "the sample must fall inside the render").toBe("running");
  expect(stats.samples).toBeGreaterThan(30);
  expect(stats.p95).toBeLessThanOrEqual(FRAME_BUDGET_MS);

  await waitJob(request, pid, job.id, 900_000);
  const v1 = await api(request, "GET", `/projects/${pid}/reports/${rid}/versions/1`);
  expect(v1.state).toBe("ready");
});
