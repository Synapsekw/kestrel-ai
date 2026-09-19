import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { errorBody, exampleProject, exampleSource, fakeClient, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { ImportImagesDialog } from "./ImportImagesDialog";

const ADVANCED = "Advanced settings (the defaults suit most imports)";

describe("ImportImagesDialog", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("prefills the project's import defaults, posts the folder and opens the jobs panel", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/sources$/, status: 202, body: { source: exampleSource, job: runningJob } },
    ]);
    const onStarted = vi.fn();
    renderWithProviders(
      <ImportImagesDialog project={exampleProject} onClose={() => {}} onStarted={onStarted} />,
      { api },
    );
    expect(screen.getByRole("dialog", { name: "Import images" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ADVANCED }));
    expect(screen.getByLabelText("Max side")).toHaveValue(4000);
    expect(screen.getByLabelText("JPEG quality")).toHaveValue(95);
    expect(screen.getByLabelText("Duplicate threshold")).toHaveValue(4);
    expect(screen.getByLabelText("Group regex")).toHaveValue(exampleProject.import_defaults.group_regex);
    expect(screen.queryByRole("button", { name: "Browse" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Folder"), {
      target: { value: "E:\\Dev\\Yolo\\Ahmadia Construction Data" },
    });
    fireEvent.change(screen.getByLabelText("Max side"), { target: { value: "3000" } });
    fireEvent.click(screen.getByRole("button", { name: "Start import" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(requests[0].body).toEqual({
      folder: "E:\\Dev\\Yolo\\Ahmadia Construction Data",
      settings: {
        max_side: 3000,
        quality: 95,
        dedupe_threshold: 4,
        group_regex: exampleProject.import_defaults.group_regex,
      },
    });
    expect(useJobsStore.getState().jobs[runningJob.id]).toBeDefined();
    // The Images screen reports the import in its own banner; the panel no longer covers the toolbar.
    expect(useJobsStore.getState().panelOpen).toBe(false);
  });

  it("sends the site name when given and shows the envelope message on failure", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/sources$/,
        status: 404,
        body: errorBody("not_found", "folder does not exist"),
      },
    ]);
    renderWithProviders(
      <ImportImagesDialog project={exampleProject} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    fireEvent.change(screen.getByLabelText("Folder"), { target: { value: "E:\\nope" } });
    fireEvent.change(screen.getByLabelText("Site name"), { target: { value: "ahmadia" } });
    fireEvent.click(screen.getByRole("button", { name: "Start import" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("folder does not exist"));
    expect(requests[0].body).toMatchObject({ folder: "E:\\nope", site: "ahmadia" });
    // The message belongs to the rejected value: editing the folder clears it.
    fireEvent.change(screen.getByLabelText("Folder"), { target: { value: "E:\\frames" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the preparation settings under Advanced, each with a plain explanation", () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <ImportImagesDialog project={exampleProject} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    const toggle = screen.getByRole("button", { name: ADVANCED });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Group regex")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(toggle.getAttribute("aria-controls") ?? "")).toContainElement(
      screen.getByLabelText("Group regex"),
    );
    expect(screen.getByText(/Longest side in pixels; larger images are scaled down/)).toBeInTheDocument();
    expect(screen.getByText(/How alike two images must be to count as duplicates/)).toBeInTheDocument();
    expect(screen.getByText(/Pattern that reads the flight number from the file name/)).toBeInTheDocument();
  });
});
