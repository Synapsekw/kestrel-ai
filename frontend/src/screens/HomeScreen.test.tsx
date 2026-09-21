import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { exampleImagePage, exampleProject, fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
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

  it("requests just three recent previews without following a cursor and survives thumbnail failure", async () => {
    useProgressStore.getState().set(PROJECT_ID, { ...base, images: 40 });
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
      { method: "GET", path: /\/images$/, body: { ...exampleImagePage, next_cursor: "more" } },
    ]);
    renderWithProviders(<HomeScreen />, { api, route: `/p/${PROJECT_ID}`, path: "/p/:projectId" });
    const previews = await screen.findAllByRole("img");
    fireEvent.error(previews[0]);
    expect(screen.getByTestId("home-next-step")).toHaveTextContent("Label");
    const imageRequests = requests.filter((r) => r.url.includes("/images?"));
    expect(imageRequests).toHaveLength(1);
    const params = new URL(imageRequests[0].url, "http://fake").searchParams;
    expect(params.get("limit")).toBe("3");
    expect(params.get("cursor")).toBeNull();
  });

  it("keeps the next action available when the preview request fails", async () => {
    useProgressStore.getState().set(PROJECT_ID, base);
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
      { method: "GET", path: /\/images$/, status: 500, body: { error: { message: "Preview unavailable" } } },
    ]);
    renderWithProviders(<HomeScreen />, { api, route: `/p/${PROJECT_ID}`, path: "/p/:projectId" });
    await waitFor(() => expect(requests.some((r) => r.url.includes("limit=3"))).toBe(true));
    expect(screen.getByRole("link", { name: "Import images" })).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
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

  it("ends the pipeline on the export once everything is labeled and reviewed", async () => {
    useProgressStore.getState().set(PROJECT_ID, {
      ...base,
      images: 10,
      labeled: 10,
      datasets: 1,
      models: 1,
      trainedModels: 1,
      queryRuns: 1,
    });
    renderHome();
    expect(await screen.findByRole("link", { name: /Export the results/ })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/export`,
    );
  });
});
