import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { fakeClient, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { ImportDesignButton } from "./ImportDesignButton";
import {
  BUILD_JOB,
  designSurface,
  exampleTarget,
  INSPECT_JOB,
  INSPECTION_ID,
  landxmlInspection,
  PREVIEW_JOB,
  readyPreview,
} from "./testFixtures";

const job = (id: string, state: string) => ({
  id,
  project_id: PROJECT_ID,
  type: "design_import" as const,
  state,
  progress: state === "succeeded" ? 1 : 0,
  message: "",
  log_path: "",
  params: {},
  result: null,
  error: null,
  created_at: "2026-09-24T09:00:00Z",
  started_at: null,
  finished_at: null,
});

function routes(): FakeRoute[] {
  return [
    { method: "GET", path: /\/surfaces$/, body: { items: [exampleTarget] } },
    {
      method: "POST",
      path: /\/design-inspections$/,
      status: 202,
      body: {
        inspection: { ...landxmlInspection, state: "inspecting", candidates: [], detected: null },
        job: job(INSPECT_JOB, "queued"),
      },
    },
    { method: "GET", path: new RegExp(`/jobs/${INSPECT_JOB}$`), body: job(INSPECT_JOB, "succeeded") },
    { method: "GET", path: new RegExp(`/design-inspections/${INSPECTION_ID}$`), body: landxmlInspection },
    {
      method: "POST",
      path: /\/previews$/,
      status: 202,
      body: { preview: { ...readyPreview, state: "running" }, job: job(PREVIEW_JOB, "queued") },
    },
    { method: "GET", path: new RegExp(`/jobs/${PREVIEW_JOB}$`), body: job(PREVIEW_JOB, "succeeded") },
    { method: "GET", path: /\/previews\/[^/]+$/, body: readyPreview },
    {
      method: "POST",
      path: /\/design-surfaces$/,
      status: 202,
      body: { surface: designSurface, job: job(BUILD_JOB, "queued") },
    },
    { method: "DELETE", path: /\/design-inspections\/[^/]+$/, status: 204 },
  ];
}

describe("ImportDesignButton", () => {
  it("opens the dialog and closes it again", () => {
    const { api } = fakeClient([{ method: "GET", path: /\/surfaces$/, body: { items: [] } }]);
    renderWithProviders(<ImportDesignButton projectId={PROJECT_ID} onChanged={() => {}} />, { api });
    fireEvent.click(screen.getByRole("button", { name: "Import design surface" }));
    expect(screen.getByRole("dialog", { name: "Import design surface" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // Deviation from the brief (controller ruling (d), Task 6 review): inspect and preview jobs
  // share the "design_import" job type with the final build job, so a type-wide
  // useOnJobsFinished("design_import", onChanged) in this button would also reload the list every
  // time the dialog's own inspect/preview step finishes — not just when an import actually starts.
  // The button must not reload merely because a design_import job (of any phase) finishes.
  it("does not reload merely because a design_import job finishes in the background", () => {
    const onChanged = vi.fn();
    const { api } = fakeClient([]);
    renderWithProviders(<ImportDesignButton projectId={PROJECT_ID} onChanged={onChanged} />, { api });
    act(() => useJobsStore.getState().upsert(job(BUILD_JOB, "running") as never));
    act(() => useJobsStore.getState().upsert(job(BUILD_JOB, "succeeded") as never));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("reloads the list once, when an import starts, and closes the dialog", async () => {
    const onChanged = vi.fn();
    const { api } = fakeClient(routes());
    renderWithProviders(<ImportDesignButton projectId={PROJECT_ID} onChanged={onChanged} />, { api });
    fireEvent.click(screen.getByRole("button", { name: "Import design surface" }));
    fireEvent.change(screen.getByLabelText("Design file"), {
      target: { value: "D:\\designs\\site-tin.xml" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Read file" }));
    await screen.findByRole("combobox", { name: "Surface" });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByRole("img", { name: "The design over the cloud surface" });
    fireEvent.click(screen.getByRole("button", { name: "Import surface" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The inspect/preview jobs that ran along the way must not have caused extra reloads.
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
