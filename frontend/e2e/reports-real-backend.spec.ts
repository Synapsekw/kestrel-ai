import { test, expect } from "@playwright/test";
import { api, seedInspectionProject, type Seeded } from "./fixtures/reportsSeed";

// Spec 2026-09-26-reports §17 flows 1-4 against the real backend (plan 2026-09-30-reports-r10,
// ruling R10-1). Serial: each flow continues from the previous one's report. Skipped in the gate;
// playwright.reports.config.ts sets E2E_REPORTS_BACKEND.
test.skip(process.env.E2E_REPORTS_BACKEND !== "1", "opt-in: pnpm -C frontend e2e:reports");
test.describe.configure({ mode: "serial" });

let seeded: Seeded;

test.beforeAll(async ({ playwright }) => {
  const request = await playwright.request.newContext();
  seeded = await seedInspectionProject(request, "Reports e2e");
  await request.dispose();
});

test("the seeded project has one image, one map and one cloud finding", async ({ request }) => {
  const page = await api(request, "GET", `/projects/${seeded.pid}/findings?limit=50`);
  const kinds = (page.items as { anchor: { kind: string } }[]).map((f) => f.anchor.kind).sort();
  expect(kinds).toEqual(["cloud", "image", "map"]);
});
