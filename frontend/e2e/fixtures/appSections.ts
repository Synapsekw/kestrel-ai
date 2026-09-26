import type { Route } from "@playwright/test";

export const P = "7f1c2e3a-1111-4000-8000-000000000001";
export const JOB = "j0000000-4444-4000-8000-000000000001";
export const T0 = "2026-09-26T08:00:00Z";

/** Answers a routed request with JSON; the dev UI and the mock are different origins. */
export function fulfilJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(body),
  });
}

/** The catalogue as the Catalogue, builder and project-types specs see it (Tasks 5, 10, 15). */
export const CATALOGUE_PAGE = {
  items: [
    {
      id: "t-1",
      name: "Excavator",
      colour: "#f97316",
      kind: "object",
      default_severity: null,
      hotkey: "1",
      group: null,
      archived: false,
      origin: "migrated",
    },
    {
      id: "t-2",
      name: "Dump truck",
      colour: "#06b6d4",
      kind: "object",
      default_severity: null,
      hotkey: "2",
      group: null,
      archived: false,
      origin: "migrated",
    },
    {
      id: "t-3",
      name: "Crack",
      colour: "#ef4444",
      kind: "defect",
      default_severity: 2,
      hotkey: "c",
      group: "Concrete defects",
      archived: false,
      origin: "user",
    },
  ],
  next_cursor: null,
  needs_classification: true,
};
