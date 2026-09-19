import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import {
  exampleModel,
  exampleProject,
  exampleTrainedModel,
  fakeClient,
  PROJECT_ID,
  runningJob,
  TRAINED_MODEL_ID,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { ModelDetail } from "./ModelDetail";

const noop = () => {};

describe("ModelDetail actions", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("starts an export job and shows it as a job card", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/export$/,
        status: 202,
        body: {
          job: { ...runningJob, type: "export", params: { model_id: TRAINED_MODEL_ID, format: "onnx" } },
        },
      },
      { method: "GET", path: /\/jobs\/[^/]+$/, body: { ...runningJob, type: "export" } },
    ]);
    renderWithProviders(
      <ModelDetail
        projectId={PROJECT_ID}
        model={exampleTrainedModel}
        project={exampleProject}
        datasetNames={{}}
        onProjectSaved={noop}
        onChanged={noop}
        onDeleted={noop}
      />,
      { api },
    );
    expect(screen.getByText("models/ahmadia-v1-n.onnx")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export ONNX" }));
    await waitFor(() => expect(screen.getByTestId(`job-${runningJob.id}`)).toBeInTheDocument());
    // requests[0] is the results.csv fetch of ModelArtifacts, so select the export by method.
    expect(requests.find((r) => r.method === "POST")).toMatchObject({
      url: `/api/v1/projects/${PROJECT_ID}/models/${TRAINED_MODEL_ID}/export`,
      body: { format: "onnx", imgsz: 1280, half: false },
    });
    expect(useJobsStore.getState().jobs[runningJob.id].type).toBe("export");
  });

  it("sets the pre-annotation model through PATCH and shows the badge when current", async () => {
    const { api, requests } = fakeClient([
      {
        method: "PATCH",
        path: /\/projects\/[^/]+$/,
        body: { ...exampleProject, preannotation_model_id: TRAINED_MODEL_ID },
      },
    ]);
    const onProjectSaved = vi.fn();
    const { unmount } = renderWithProviders(
      <ModelDetail
        projectId={PROJECT_ID}
        model={exampleTrainedModel}
        project={exampleProject}
        datasetNames={{}}
        onProjectSaved={onProjectSaved}
        onChanged={noop}
        onDeleted={noop}
      />,
      { api },
    );
    fireEvent.click(screen.getByRole("button", { name: "Use as pre-annotation model" }));
    await waitFor(() => expect(onProjectSaved).toHaveBeenCalled());
    expect(requests.find((r) => r.method === "PATCH")).toMatchObject({
      url: `/api/v1/projects/${PROJECT_ID}`,
      body: { preannotation_model_id: TRAINED_MODEL_ID },
    });
    // `rerender` would replace the provider tree too, so mount the second model afresh:
    // exampleProject.preannotation_model_id already points at exampleModel.
    unmount();
    renderWithProviders(
      <ModelDetail
        projectId={PROJECT_ID}
        model={exampleModel}
        project={exampleProject}
        datasetNames={{}}
        onProjectSaved={onProjectSaved}
        onChanged={noop}
        onDeleted={noop}
      />,
      { api },
    );
    expect(screen.getByText("Pre-annotation model")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use as pre-annotation model" })).not.toBeInTheDocument();
  });

  it("deletes only after confirmation", async () => {
    const { api, requests } = fakeClient([{ method: "DELETE", path: /\/models\/[^/]+$/, status: 204 }]);
    const onDeleted = vi.fn();
    renderWithProviders(
      <ModelDetail
        projectId={PROJECT_ID}
        model={exampleTrainedModel}
        project={exampleProject}
        datasetNames={{}}
        onProjectSaved={noop}
        onChanged={noop}
        onDeleted={onDeleted}
      />,
      { api },
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete model" }));
    expect(requests.filter((r) => r.method === "DELETE")).toHaveLength(0);
    expect(screen.getByText(/Delete ahmadia-v1-n\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(TRAINED_MODEL_ID));
    expect(requests.find((r) => r.method === "DELETE")).toMatchObject({
      url: `/api/v1/projects/${PROJECT_ID}/models/${TRAINED_MODEL_ID}`,
    });
  });

  it("says how many of the model's classes produce proposals in this project", () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <ModelDetail
        projectId={PROJECT_ID}
        model={exampleModel}
        project={exampleProject}
        datasetNames={{}}
        onProjectSaved={noop}
        onChanged={noop}
        onDeleted={noop}
      />,
      { api },
    );
    expect(screen.getByTestId("class-mapping")).toHaveTextContent(
      "1 of 8 classes maps to this project: truck → dump_truck. Detections of the other 7 are dropped.",
    );
  });
});
