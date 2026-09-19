import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { exampleModel, exampleTrainedModel, fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { ModelExportSection } from "./ModelExportSection";

describe("ModelExportSection", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("shows the no-models note when the registry is empty", () => {
    const { api } = fakeClient([]);
    renderWithProviders(<ModelExportSection projectId={PROJECT_ID} models={[]} />, { api });
    expect(screen.getByText("No models yet.")).toBeInTheDocument();
  });

  it("shows a trained model's existing ONNX export immediately, ahead of an imported model", () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <ModelExportSection projectId={PROJECT_ID} models={[exampleModel, exampleTrainedModel]} />,
      { api },
    );
    const select = screen.getByRole("combobox", { name: "Model" }) as HTMLSelectElement;
    const options = within(select).getAllByRole("option");
    expect(options[0]).toHaveTextContent(exampleTrainedModel.name); // trained first
    expect(select.value).toBe(exampleTrainedModel.id);
    expect(screen.getByText(exampleTrainedModel.exports.onnx)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show in folder" })).toBeInTheDocument();
  });

  it("starts an ONNX export for the selected model, then reveals the finished path once it succeeds", async () => {
    const finished = {
      ...runningJob,
      type: "export" as const,
      state: "succeeded" as const,
      result: { format: "onnx", path: "models/yolo11m-coco.onnx" },
    };
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/export$/,
        status: 202,
        body: { job: { ...runningJob, type: "export", state: "queued" } },
      },
      { method: "GET", path: /\/jobs\//, body: finished },
      { method: "POST", path: /\/reveal$/, status: 204 },
    ]);
    renderWithProviders(<ModelExportSection projectId={PROJECT_ID} models={[exampleModel]} />, { api });
    fireEvent.click(screen.getByRole("button", { name: "Export ONNX" }));
    expect(await screen.findByText("models/yolo11m-coco.onnx")).toBeInTheDocument();
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/models/${exampleModel.id}/export`,
      body: { format: "onnx" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Show in folder" }));
    await screen.findByRole("button", { name: "Show in folder" });
    expect(requests.find((r) => r.method === "POST" && r.url.endsWith("/reveal"))).toMatchObject({
      body: { path: "models/yolo11m-coco.onnx" },
    });
  });
});
