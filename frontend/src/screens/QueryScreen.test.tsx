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
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Cloud provider"));
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
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
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
    fireEvent.click(screen.getByLabelText("Cloud provider"));
    fireEvent.click(screen.getByRole("button", { name: "Estimate" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Describe what to find");
    fireEvent.change(screen.getByLabelText("Query"), { target: { value: "cranes" } });
    fireEvent.click(screen.getByRole("button", { name: "Estimate" }));
    await waitFor(() =>
      expect(screen.getByRole("note")).toHaveTextContent("Query runs are not available yet"),
    );
    expect(screen.getByRole("heading", { name: "Query" })).toBeInTheDocument();
  });
});
