import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { REPORT_ID_2, report, TEMPLATES } from "@/test/reportBuilderFixtures";
import { NewReportDialog } from "./NewReportDialog";

function setup(initialTemplateId: string | null = null) {
  const onClose = vi.fn();
  const { api, requests } = fakeClient([
    { method: "GET", path: /\/report-templates$/, body: { items: TEMPLATES, next_cursor: null } },
    {
      method: "POST",
      path: /\/projects\/[^/]+\/reports$/,
      status: 201,
      body: (r) => report({ id: REPORT_ID_2, title: (r.body as { title: string }).title }),
    },
  ]);
  renderWithProviders(
    <>
      <NewReportDialog projectId={PROJECT_ID} open onClose={onClose} initialTemplateId={initialTemplateId} />
      <LocationProbe />
    </>,
    { api, route: `/p/${PROJECT_ID}/reports` },
  );
  return { onClose, requests };
}

const dialog = () => screen.getByRole("dialog", { name: "New report" });

describe("NewReportDialog", () => {
  it("lists the templates and creates a report from the chosen one", async () => {
    const { requests, onClose } = setup();
    fireEvent.click(await within(dialog()).findByRole("radio", { name: /Findings summary/ }));
    expect(within(dialog()).getByLabelText("Title")).toHaveValue("Findings summary");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Create report" }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/reports/${REPORT_ID_2}`),
    );
    expect(requests.find((r) => r.method === "POST")?.body).toEqual({
      title: "Findings summary",
      template_id: "builtin-findings-summary",
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("preselects the template the link asked for, and a typed title wins", async () => {
    const { requests } = setup("builtin-survey-counts");
    expect(await within(dialog()).findByRole("radio", { name: /Survey count report/ })).toBeChecked();
    fireEvent.change(within(dialog()).getByLabelText("Title"), { target: { value: "North yard counts" } });
    fireEvent.click(within(dialog()).getByRole("radio", { name: /Volumes report/ }));
    expect(within(dialog()).getByLabelText("Title")).toHaveValue("North yard counts");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Create report" }));
    await waitFor(() =>
      expect(requests.find((r) => r.method === "POST")?.body).toEqual({
        title: "North yard counts",
        template_id: "builtin-volumes",
      }),
    );
  });

  it("an unknown template id falls back to the first", async () => {
    setup("builtin-gone");
    expect(await within(dialog()).findByRole("radio", { name: /Full inspection report/ })).toBeChecked();
  });

  it("will not create a report without a title", async () => {
    setup();
    await within(dialog()).findByRole("radio", { name: /Full inspection report/ });
    fireEvent.change(within(dialog()).getByLabelText("Title"), { target: { value: "  " } });
    expect(within(dialog()).getByRole("button", { name: "Create report" })).toBeDisabled();
  });
});
