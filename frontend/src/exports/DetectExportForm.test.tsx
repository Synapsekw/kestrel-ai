import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { Source } from "@contract/client";
import { exampleSource, fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { DetectExportForm } from "./DetectExportForm";

const photos: Source = { ...exampleSource, id: "src-photos", label: "Flight A", captured_on: "2026-03-01" };
const map: Source = {
  ...exampleSource,
  id: "src-map",
  kind: "map",
  label: "April ortho",
  captured_on: "2026-04-01",
  map_id: "map-1",
};

function renderForm(sources: Source[] = [photos, map]) {
  const { api, requests } = fakeClient([
    { method: "GET", path: /\/sources$/, body: { items: sources, next_cursor: null } },
    {
      method: "POST",
      path: /\/detect-exports$/,
      status: 202,
      body: { job: { ...runningJob, type: "detect_export" } },
    },
  ]);
  renderWithProviders(<DetectExportForm projectId={PROJECT_ID} />, { api });
  return { requests };
}

const posted = (requests: { method: string; url: string; body?: unknown }[]) =>
  requests.filter((r) => r.method === "POST" && r.url.endsWith("/detect-exports"));

describe("DetectExportForm", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {} }));

  it("exports the CSV of every source by default", async () => {
    const { requests } = renderForm();
    await screen.findByRole("option", { name: /April ortho/ });
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(posted(requests)).toHaveLength(1));
    expect(posted(requests)[0].body).toEqual({ format: "csv" });
    expect(Object.values(useJobsStore.getState().jobs)[0]?.type).toBe("detect_export");
  });

  it("exports the CSV of the chosen source", async () => {
    const { requests } = renderForm();
    await screen.findByRole("option", { name: /Flight A/ });
    fireEvent.change(screen.getByLabelText("Sources"), { target: { value: "src-map" } });
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(posted(requests)).toHaveLength(1));
    expect(posted(requests)[0].body).toEqual({ format: "csv", source_id: "src-map" });
  });

  it("offers no PDF: the per-source report is a Survey count report now", () => {
    renderForm();
    expect(screen.getByText(/One row per source, class and site area/)).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /PDF/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/One report per source/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create a Survey count report" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/reports?new=builtin-survey-counts`,
    );
  });

  it("waits for a source before exporting", async () => {
    renderForm([]);
    expect(await screen.findByText(/Add photos or a map/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
  });
});
