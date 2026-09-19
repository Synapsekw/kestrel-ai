import { beforeEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { exampleProject, fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { useProgressStore } from "@/store/progress";
import { HomeScreen } from "./HomeScreen";

const base = {
  images: 0,
  labeled: 0,
  pendingReview: 0,
  datasets: 0,
  models: 0,
  trainedModels: 0,
  queryRuns: 0,
};

function renderHome() {
  const { api } = fakeClient([{ method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject }]);
  return renderWithProviders(<HomeScreen />, {
    api,
    route: `/p/${PROJECT_ID}`,
    path: "/p/:projectId",
  });
}

describe("HomeScreen", () => {
  beforeEach(() => {
    useJobsStore.setState({ jobs: {}, panelOpen: false });
    useProgressStore.setState({ byProject: {} });
  });

  it("names the project, its counts and the next step with a link to it", async () => {
    useProgressStore
      .getState()
      .set(PROJECT_ID, { ...base, images: 40, labeled: 14, datasets: 1, models: 2, trainedModels: 1 });
    renderHome();
    expect(await screen.findByRole("heading", { name: exampleProject.name })).toBeInTheDocument();
    expect(screen.getByText(exampleProject.folder)).toBeInTheDocument();
    expect(screen.getByText("14 of 40")).toBeInTheDocument();
    expect(screen.getByText("2 (1 trained)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Run detection on 26 unlabeled images/ })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/query`,
    );
    expect(screen.getByText("Nothing is running.")).toBeInTheDocument();
  });

  it("lists running jobs with their progress", async () => {
    useProgressStore.getState().set(PROJECT_ID, { ...base, images: 40 });
    useJobsStore.getState().upsert({ ...runningJob, project_id: PROJECT_ID, type: "train", progress: 0.4 });
    renderHome();
    expect(await screen.findByText("Training")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Training" })).toHaveAttribute("aria-valuenow", "40");
  });

  it("says so when nothing is left to do", async () => {
    useProgressStore
      .getState()
      .set(PROJECT_ID, {
        ...base,
        images: 10,
        labeled: 10,
        datasets: 1,
        models: 1,
        trainedModels: 1,
        queryRuns: 1,
      });
    renderHome();
    expect(await screen.findByText("Everything is labeled and reviewed.")).toBeInTheDocument();
    expect(screen.queryByTestId("home-next-step")).toBeNull();
  });
});
