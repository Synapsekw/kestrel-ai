import type { Page } from "@playwright/test";

/**
 * Serves the mock's example project as a detection project. The mock answers `kind: train`, and
 * the Detect and Maps screens only open in detection projects.
 */
export async function asDetectionProject(page: Page, projectId: string): Promise<void> {
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${projectId}`,
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const response = await route.fetch();
      const project = (await response.json()) as Record<string, unknown>;
      await route.fulfill({ response, json: { ...project, kind: "detect" } });
    },
  );
}
