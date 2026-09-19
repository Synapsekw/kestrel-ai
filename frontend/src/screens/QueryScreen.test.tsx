import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import {
  errorBody,
  exampleEstimate,
  exampleImagePage,
  exampleModel,
  exampleProject,
  exampleProviders,
  exampleQueryRun,
  fakeClient,
  IMAGE_ID,
  IMAGE_ID_2,
  PROJECT_ID,
  runningJob,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { useNavigationStore } from "@/store/navigation";
import { QueryScreen } from "./QueryScreen";

const base = [
  { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
  { method: "GET", path: /\/models$/, body: { items: [exampleModel], next_cursor: null } },
  { method: "GET", path: /\/providers$/, body: { items: exampleProviders } },
  { method: "GET", path: /\/images$/, body: exampleImagePage },
  { method: "GET", path: /\/query-runs\/[^/]+$/, body: exampleQueryRun },
  { method: "GET", path: /\/jobs\/[^/]+$/, body: { ...runningJob, type: "infer" } },
  { method: "GET", path: /\/query-runs$/, body: { items: [exampleQueryRun], next_cursor: null } },
];

describe("QueryScreen", () => {
  beforeEach(() => {
    useJobsStore.setState({ jobs: {}, panelOpen: false });
    useNavigationStore.setState({ ids: [], source: null });
  });

  it("estimates a cloud query over unlabeled images, then starts the run", async () => {
    const { api, requests } = fakeClient([
      ...base,
      { method: "POST", path: /\/estimate$/, body: exampleEstimate },
      {
        method: "POST",
        path: /\/query-runs$/,
        status: 202,
        body: { query_run: exampleQueryRun, job: { ...runningJob, type: "infer" } },
      },
    ]);
    renderWithProviders(<QueryScreen />, {
      api,
      route: `/p/${PROJECT_ID}/query`,
      path: "/p/:projectId/query",
    });
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue(exampleModel.id));
    await waitFor(() => expect(screen.getByTestId("image-count")).toHaveTextContent("2 images selected"));
    fireEvent.click(screen.getByRole("radio", { name: "Cloud provider" }));
    // A cloud run costs money: it cannot start before its estimate was shown.
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
    expect(
      screen.getByText("Estimate the cost first; Start then runs exactly that request."),
    ).toBeInTheDocument();
    const provider = screen.getByLabelText("Provider");
    expect(provider).toHaveValue("anthropic");
    expect(screen.getByRole("option", { name: /OpenAI/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Query"), { target: { value: "dump trucks" } });
    fireEvent.click(screen.getByRole("button", { name: "Estimate" }));
    await waitFor(() => expect(screen.getByTestId("estimate")).toHaveTextContent("40 requests"));
    expect(screen.getByTestId("estimate")).toHaveTextContent("$0.80");
    const expected = {
      kind: "cloud_provider",
      provider: "anthropic",
      query: "dump trucks",
      image_ids: [IMAGE_ID, IMAGE_ID_2],
      tiling: { enabled: true, tile_size: 1280, overlap: 0.2, nms_iou: 0.5 },
      conf: 0.25,
    };
    expect(requests.find((r) => r.url.endsWith("/estimate"))?.body).toEqual(expected);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByTestId("run-card")).toBeInTheDocument());
    expect(requests.find((r) => r.method === "POST" && r.url.endsWith("/query-runs"))?.body).toEqual(
      expected,
    );
    expect(useJobsStore.getState().jobs[runningJob.id].type).toBe("infer");
    expect(screen.getByTestId("run-history")).toHaveTextContent("dump trucks");
  });

  it("says in plain words what the screen does and where the results go", async () => {
    const { api } = fakeClient(base);
    renderWithProviders(<QueryScreen />, {
      api,
      route: `/p/${PROJECT_ID}/query`,
      path: "/p/:projectId/query",
    });
    expect(screen.getByTestId("query-intro")).toHaveTextContent(
      "Run a model over images; it suggests boxes for you to review.",
    );
    expect(screen.getByRole("link", { name: "review" })).toHaveAttribute("href", `/p/${PROJECT_ID}/review`);
  });

  it("shows an opened run with New detection, which returns to the form", async () => {
    const { api } = fakeClient(base);
    renderWithProviders(<QueryScreen />, {
      api,
      route: `/p/${PROJECT_ID}/query?run=${exampleQueryRun.id}`,
      path: "/p/:projectId/query",
    });
    expect(await screen.findByTestId("run-card")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New detection" }));
    expect(screen.queryByTestId("run-card")).not.toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Source" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New detection" })).not.toBeInTheDocument();
  });

  it("starts a local run without asking for an estimate first", async () => {
    const { api, requests } = fakeClient([
      ...base,
      {
        method: "POST",
        path: /\/query-runs$/,
        status: 202,
        body: { query_run: exampleQueryRun, job: { ...runningJob, type: "infer" } },
      },
    ]);
    renderWithProviders(<QueryScreen />, {
      api,
      route: `/p/${PROJECT_ID}/query`,
      path: "/p/:projectId/query",
    });
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue(exampleModel.id));
    await waitFor(() => expect(screen.getByTestId("image-count")).toHaveTextContent("2 images selected"));
    expect(screen.getByText(/Runs on this computer at no cost/)).toBeInTheDocument();
    const start = screen.getByRole("button", { name: "Start" });
    expect(start).toBeEnabled();
    fireEvent.click(start);
    await waitFor(() =>
      expect(requests.some((r) => r.method === "POST" && /\/query-runs$/.test(r.url))).toBe(true),
    );
    expect(requests.some((r) => r.url.endsWith("/estimate"))).toBe(false);
  });

  it("preloads a Data Manager selection and clears a stale estimate when the form changes", async () => {
    useNavigationStore.getState().setContext([IMAGE_ID], "query");
    const { api } = fakeClient([...base, { method: "POST", path: /\/estimate$/, body: exampleEstimate }]);
    renderWithProviders(<QueryScreen />, {
      api,
      route: `/p/${PROJECT_ID}/query`,
      path: "/p/:projectId/query",
    });
    await waitFor(() => expect(screen.getByLabelText("Images")).toHaveValue("selection"));
    expect(screen.getByTestId("image-count")).toHaveTextContent("1 image selected");
    fireEvent.click(screen.getByRole("button", { name: "Estimate" }));
    await waitFor(() => expect(screen.getByTestId("estimate")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Confidence"), { target: { value: "0.5" } });
    expect(screen.queryByTestId("estimate")).not.toBeInTheDocument();
    // Local model: Start does not depend on the estimate (the cloud test covers the disabled case).
    expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
  });

  it("consumes the carried selection once: the navigation context is cleared", async () => {
    useNavigationStore.getState().setContext([IMAGE_ID], "query");
    const { api } = fakeClient(base);
    renderWithProviders(<QueryScreen />, {
      api,
      route: `/p/${PROJECT_ID}/query`,
      path: "/p/:projectId/query",
    });
    await waitFor(() => expect(screen.getByLabelText("Images")).toHaveValue("selection"));
    // The screen keeps its snapshot, but the store no longer carries a query selection.
    expect(screen.getByTestId("image-count")).toHaveTextContent("1 image selected");
    expect(useNavigationStore.getState().source).toBeNull();
    expect(useNavigationStore.getState().ids).toEqual([]);
  });

  it("refuses an invalid form and shows the not-available note on 501", async () => {
    const { api } = fakeClient([
      ...base,
      { method: "POST", path: /\/estimate$/, status: 501, body: errorBody("not_implemented", "S4 later") },
    ]);
    renderWithProviders(<QueryScreen />, {
      api,
      route: `/p/${PROJECT_ID}/query`,
      path: "/p/:projectId/query",
    });
    await waitFor(() => expect(screen.getByTestId("image-count")).toHaveTextContent("2 images selected"));
    fireEvent.click(screen.getByRole("radio", { name: "Cloud provider" }));
    fireEvent.click(screen.getByRole("button", { name: "Estimate" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Describe what to find");
    fireEvent.change(screen.getByLabelText("Query"), { target: { value: "cranes" } });
    fireEvent.click(screen.getByRole("button", { name: "Estimate" }));
    await waitFor(() =>
      expect(screen.getByRole("note")).toHaveTextContent("Detection runs are not available yet"),
    );
    expect(screen.getByRole("heading", { name: "Detect" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add a starter model" })).not.toBeInTheDocument();
  });

  it("points to a starter model once the registry has loaded and is empty, not before", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
      { method: "GET", path: /\/models$/, body: { items: [], next_cursor: null } },
      { method: "GET", path: /\/providers$/, body: { items: exampleProviders } },
      { method: "GET", path: /\/images$/, body: exampleImagePage },
      { method: "GET", path: /\/query-runs$/, body: { items: [], next_cursor: null } },
    ]);
    renderWithProviders(<QueryScreen />, {
      api,
      route: `/p/${PROJECT_ID}/query`,
      path: "/p/:projectId/query",
    });
    // Synchronous: the models request has not resolved yet, so the hint must not appear early.
    expect(screen.queryByRole("link", { name: "Add a starter model" })).not.toBeInTheDocument();
    const link = await screen.findByRole("link", { name: "Add a starter model" });
    expect(link).toHaveAttribute("href", `/p/${PROJECT_ID}/models`);
  });

  it("says so when the model registry is unavailable or failed, and offers no starter hint", async () => {
    const withoutModels = base.filter((r) => !r.path.test("/api/v1/projects/p/models"));
    const notYet = fakeClient([
      ...withoutModels,
      { method: "GET", path: /\/models$/, status: 501, body: errorBody("not_implemented", "later") },
    ]);
    const first = renderWithProviders(<QueryScreen />, {
      api: notYet.api,
      route: `/p/${PROJECT_ID}/query`,
      path: "/p/:projectId/query",
    });
    expect(await screen.findByText("The model registry is not available yet.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add a starter model" })).toBeNull();
    first.unmount();

    const broken = fakeClient([
      ...withoutModels,
      { method: "GET", path: /\/models$/, status: 500, body: errorBody("internal", "database is locked") },
    ]);
    renderWithProviders(<QueryScreen />, {
      api: broken.api,
      route: `/p/${PROJECT_ID}/query`,
      path: "/p/:projectId/query",
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("database is locked");
    expect(screen.queryByRole("link", { name: "Add a starter model" })).toBeNull();
  });
});
