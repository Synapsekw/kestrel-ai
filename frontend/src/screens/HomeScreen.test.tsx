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
  maps: 0,
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
    const heroUrl = new URL(previews[0].getAttribute("src")!);
    expect(heroUrl.pathname).toMatch(/\/file$/);
    expect(heroUrl.searchParams.get("max_side")).toBe("1024");
    expect(
      previews.slice(1).every((image) => new URL(image.getAttribute("src")!).pathname.endsWith("/thumbnail")),
    ).toBe(true);
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
    expect(screen.getByText("Training project")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Label 26 more images/ })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/label`,
    );
    expect(screen.queryByText("Detection runs")).toBeNull();
    expect(screen.getByText("Nothing is running.")).toBeInTheDocument();
  });

  it("speaks of sources, runs and maps in a detection project", async () => {
    useProgressStore.getState().set(PROJECT_ID, { ...base, images: 12, maps: 2, queryRuns: 3 });
    const { api } = fakeClient([
      { method: "GET", path: /\/projects\/[^/]+$/, body: { ...exampleProject, kind: "detect", classes: [] } },
    ]);
    renderWithProviders(<HomeScreen />, { api, route: `/p/${PROJECT_ID}`, path: "/p/:projectId" });
    expect(await screen.findByText("Detection project")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Add a model to the library/ })).toHaveAttribute(
      "href",
      "/library",
    );
    expect(screen.getByText("Maps")).toBeInTheDocument();
    expect(screen.getByText("Detection runs")).toBeInTheDocument();
    expect(screen.queryByText("Labeled")).toBeNull();
    expect(screen.queryByText("Datasets")).toBeNull();
    expect(screen.getByText("12 images and 2 maps")).toBeInTheDocument();
  });

  it("shows the models that could not move into the library, above the next step", async () => {
    useProgressStore.getState().set(PROJECT_ID, base);
    const { api } = fakeClient([
      { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
      {
        method: "GET",
        path: /\/adoption$/,
        body: {
          pending: 1,
          adopted: 0,
          missing: [{ old_model_id: "old-1", name: "yard-v1", error: "weights file not found: models/yard-v1.pt" }],
          job_id: null,
        },
      },
    ]);
    renderWithProviders(<HomeScreen />, { api, route: `/p/${PROJECT_ID}`, path: "/p/:projectId" });
    expect(await screen.findByText("One model could not be moved into your library")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
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
