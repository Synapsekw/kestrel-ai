import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { exampleJobLog, fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { TrainProgress } from "./TrainProgress";

describe("TrainProgress", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("shows epoch, mAP50 and elapsed from the running job", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/log$/, body: exampleJobLog },
      { method: "GET", path: /\/jobs\/[^/]+$/, body: runningJob },
    ]);
    useJobsStore
      .getState()
      .upsert({ ...runningJob, type: "train", message: "epoch 3/50 mAP50 0.612", progress: 0.06 });
    renderWithProviders(<TrainProgress projectId={PROJECT_ID} jobId={runningJob.id} />, { api });
    expect(screen.getByTestId("epoch")).toHaveTextContent("3 / 50");
    expect(screen.getByTestId("map50")).toHaveTextContent("61.2%");
    expect(screen.getByTestId("elapsed")).not.toHaveTextContent("–");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "6");
    expect(screen.queryByTestId("jobcard-log")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show log" }));
    expect(await screen.findByTestId("jobcard-log")).toHaveTextContent("job started");
    expect(screen.getByRole("button", { name: "Cancel job" })).toBeInTheDocument();
  });

  it("shows the loss terms and the ETA when the message carries them", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/jobs\/[^/]+$/, body: { ...runningJob, type: "train" } },
    ]);
    useJobsStore.getState().upsert({
      ...runningJob,
      type: "train",
      message: "epoch 2/10 mAP50 0.500 loss box 1.234 cls 2.346 dfl 1.111 ETA 252s",
      progress: 0.2,
    });
    renderWithProviders(<TrainProgress projectId={PROJECT_ID} jobId={runningJob.id} />, { api });
    expect(screen.getByTestId("loss")).toHaveTextContent("box 1.234");
    expect(screen.getByTestId("loss")).toHaveTextContent("cls 2.346");
    expect(screen.getByTestId("loss")).toHaveTextContent("dfl 1.111");
    expect(screen.getByTestId("eta")).toHaveTextContent("4 min 12 s");
  });

  it("links the registered model when the job succeeded", () => {
    const { api } = fakeClient([{ method: "GET", path: /\/log$/, body: exampleJobLog }]);
    useJobsStore.getState().upsert({
      ...runningJob,
      type: "train",
      state: "succeeded",
      progress: 1,
      message: "epoch 3/3 mAP50 0.710",
      result: { model_id: "m9", metrics: {} },
      finished_at: "2026-09-17T10:20:00Z",
    });
    renderWithProviders(<TrainProgress projectId={PROJECT_ID} jobId={runningJob.id} />, { api });
    expect(screen.getByText("Training finished: the model is registered.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open model" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/models?model=m9`,
    );
    expect(screen.getByTestId("map50")).toHaveTextContent("71.0%");
    expect(screen.getByTestId("elapsed")).toHaveTextContent("14 min 59 s");
  });

  it("warns instead of congratulating when the finished model scores next to nothing", () => {
    const { api } = fakeClient([{ method: "GET", path: /\/log$/, body: exampleJobLog }]);
    useJobsStore.getState().upsert({
      ...runningJob,
      type: "train",
      state: "succeeded",
      progress: 1,
      message: "epoch 3/3 mAP50 0.000 loss box 4.718 cls 17.227 dfl 2.570 ETA 0s",
      result: { model_id: "m9", metrics: {} },
      finished_at: "2026-09-17T10:20:00Z",
    });
    renderWithProviders(<TrainProgress projectId={PROJECT_ID} jobId={runningJob.id} />, { api });
    expect(screen.getByTestId("result-advice")).toHaveTextContent(
      "mAP50 is 0.0%: this model will find little or nothing.",
    );
    // A succeeded job with a usable score carries no such warning (previous test: 71.0%).
  });

  it("carries no warning when the finished model has a usable score", () => {
    const { api } = fakeClient([{ method: "GET", path: /\/log$/, body: exampleJobLog }]);
    useJobsStore.getState().upsert({
      ...runningJob,
      type: "train",
      state: "succeeded",
      progress: 1,
      message: "epoch 3/3 mAP50 0.710",
      result: { model_id: "m9", metrics: {} },
      finished_at: "2026-09-17T10:20:00Z",
    });
    renderWithProviders(<TrainProgress projectId={PROJECT_ID} jobId={runningJob.id} />, { api });
    expect(screen.queryByTestId("result-advice")).toBeNull();
  });
});
