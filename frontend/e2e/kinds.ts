import type { Page } from "@playwright/test";

/** The Prism mock, on the port playwright.config.ts starts it on. */
const MOCK = `http://127.0.0.1:${process.env.E2E_MOCK_PORT ?? 4010}`;

/**
 * Reads `path` from the mock once, up front, so a route handler can answer from memory. A handler
 * that called `route.fetch()` could still be waiting on the mock when the test ended, and Playwright
 * then fails the test with "route.fetch: Test ended".
 */
export async function fromMock<T = Record<string, unknown>>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(`${MOCK}${path}`, { headers: { Authorization: "Bearer mock" } });
  return (await response.json()) as T;
}

/** A JSON reply the app (on another origin than the mock) accepts. */
export const jsonReply = (body: unknown, status = 200) => ({
  status,
  contentType: "application/json",
  headers: { "Access-Control-Allow-Origin": "*" },
  body: JSON.stringify(body),
});

/**
 * Serves the mock's example project as a detection project. The mock answers `kind: train`, and
 * the Detect and Maps screens only open in detection projects.
 */
export async function asDetectionProject(page: Page, projectId: string): Promise<void> {
  const project = { ...(await fromMock(page, `/api/v1/projects/${projectId}`)), kind: "detect" };
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${projectId}`,
    (route) => (route.request().method() === "GET" ? route.fulfill(jsonReply(project)) : route.fallback()),
  );
}
