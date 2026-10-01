import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReportListItem } from "@/api/reports";
import { fakeClient, PROJECT_ID, type RecordedRequest } from "@/test/fixtures";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { listItem, REPORT_ID, REPORT_ID_2, report, TEMPLATES } from "@/test/reportBuilderFixtures";
import { useToastStore } from "@/ui";
import { ReportList } from "./ReportList";

/** The list route keeps its own state, so a reload after duplicate or delete reads the change. */
function setup(initial: ReportListItem[] = [listItem()], search = "", nextCursor: string | null = null) {
  let items = [...initial];
  const { api, requests } = fakeClient([
    {
      method: "GET",
      path: /\/projects\/[^/]+\/reports$/,
      body: (r) =>
        r.url.includes("cursor=")
          ? {
              items: [listItem({ id: "older", title: "August inspection", last_version: null })],
              next_cursor: null,
            }
          : { items, next_cursor: nextCursor },
    },
    { method: "GET", path: /\/report-templates$/, body: { items: TEMPLATES, next_cursor: null } },
    {
      method: "POST",
      path: /\/duplicate$/,
      body: () => {
        items = [
          listItem({ id: REPORT_ID_2, title: "Site inspection September (copy)", last_version: null }),
          ...items,
        ];
        return report({ id: REPORT_ID_2, title: "Site inspection September (copy)" });
      },
    },
    {
      method: "DELETE",
      path: /\/reports\/[^/]+$/,
      status: (r) => {
        const id = r.url.split("/").pop();
        items = items.filter((x) => x.id !== id);
        return 204;
      },
    },
  ]);
  renderWithProviders(
    <>
      <ReportList projectId={PROJECT_ID} />
      <LocationProbe />
    </>,
    { api, route: `/p/${PROJECT_ID}/reports${search}`, path: "/p/:projectId/*" },
  );
  return requests;
}

const card = (title: string) => screen.getByRole("region", { name: title });
const listReads = (rq: RecordedRequest[]) =>
  rq.filter((r) => r.method === "GET" && /\/reports\?/.test(r.url));

describe("ReportList", () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }));

  it("shows each report as a card with its template, version and pages", async () => {
    setup([
      listItem(),
      listItem({
        id: "d",
        title: "Draft one",
        last_version: { number: 2, state: "ready", issued_at: null, pages: 10 },
      }),
      listItem({
        id: "r",
        title: "Running one",
        last_version: { number: null, state: "rendering", issued_at: null, pages: null },
      }),
      listItem({ id: "n", title: "New one", template_id: "builtin-volumes", last_version: null }),
    ]);
    const c = await screen.findByRole("region", { name: "Site inspection September" });
    expect(within(c).getByText("Issued v3 · 24 Sep")).toBeInTheDocument();
    expect(within(c).getByText("38 pages")).toBeInTheDocument();
    expect(await within(c).findByText("Full inspection report")).toBeInTheDocument();
    expect(within(card("Draft one")).getByText("Draft v2")).toBeInTheDocument();
    expect(within(card("Running one")).getByText("Rendering…")).toBeInTheDocument();
    expect(within(card("New one")).getByText("No versions yet")).toBeInTheDocument();
    expect(within(c).getByRole("link", { name: "Site inspection September" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/reports/${REPORT_ID}`,
    );
  });

  it("offers New report when there are none", async () => {
    setup([]);
    expect(await screen.findByText("No reports yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New report" }));
    expect(screen.getByRole("dialog", { name: "New report" })).toBeInTheDocument();
  });

  it("?new= opens New report with that template chosen and clears the address", async () => {
    setup([listItem()], "?new=builtin-survey-counts");
    const dialog = await screen.findByRole("dialog", { name: "New report" });
    expect(await within(dialog).findByRole("radio", { name: /Survey count report/ })).toBeChecked();
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe(`/p/${PROJECT_ID}/reports`));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "New report" })).toBeNull();
  });

  it("duplicates a report and re-reads the list", async () => {
    const requests = setup();
    await screen.findByRole("region", { name: "Site inspection September" });
    fireEvent.click(screen.getByRole("button", { name: "Actions for Site inspection September" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(
      await screen.findByRole("region", { name: "Site inspection September (copy)" }),
    ).toBeInTheDocument();
    expect(
      requests.some((r) => r.method === "POST" && r.url.endsWith(`/reports/${REPORT_ID}/duplicate`)),
    ).toBe(true);
    expect(useToastStore.getState().toasts.at(-1)?.text).toBe(
      "Duplicated as “Site inspection September (copy)”",
    );
  });

  it("archives a report with versions and deletes one without", async () => {
    const requests = setup([listItem(), listItem({ id: "n", title: "New one", last_version: null })]);
    await screen.findByRole("region", { name: "New one" });
    fireEvent.click(screen.getByRole("button", { name: "Actions for Site inspection September" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Site inspection September" })).toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Actions for New one" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "New one" })).toBeNull());
    expect(requests.filter((r) => r.method === "DELETE")).toHaveLength(2);
  });

  it("loads older reports on request, 50 at a time", async () => {
    const requests = setup([listItem()], "", "c2");
    fireEvent.click(await screen.findByRole("button", { name: "Load more reports" }));
    expect(await screen.findByRole("region", { name: "August inspection" })).toBeInTheDocument();
    expect(listReads(requests).at(-1)!.url).toContain("cursor=c2");
    expect(listReads(requests)[0].url).toContain("limit=50");
  });
});
