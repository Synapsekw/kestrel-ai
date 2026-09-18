import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import {
  errorBody,
  exampleDataset,
  exampleModel,
  exampleProject,
  exampleTrainedModel,
  fakeClient,
  PROJECT_ID,
  RESULTS_CSV,
  TRAINED_MODEL_ID,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ModelsScreen } from "./ModelsScreen";

const routes = [
  { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
  {
    method: "GET",
    path: /\/models$/,
    body: { items: [exampleTrainedModel, exampleModel], next_cursor: null },
  },
  { method: "GET", path: /\/datasets$/, body: { items: [exampleDataset], next_cursor: null } },
  { method: "GET", path: /\/artifacts\/results_csv$/, body: RESULTS_CSV, raw: true },
];

describe("ModelsScreen", () => {
  it("lists the registry with metrics and opens the detail from the ?model= param", async () => {
    const { api } = fakeClient(routes);
    renderWithProviders(<ModelsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/models?model=${TRAINED_MODEL_ID}`,
      path: "/p/:projectId/models",
    });
    expect(await screen.findByRole("heading", { name: "Models" })).toBeInTheDocument();
    const table = await screen.findByTestId("model-table");
    await waitFor(() => expect(table).toHaveTextContent("ahmadia-v1-n"));
    const row = screen.getByRole("button", { name: "Select model ahmadia-v1-n" }).closest("tr");
    expect(row).toHaveTextContent("Trained");
    expect(row).toHaveTextContent("v1");
    expect(row).toHaveTextContent("71.0%");
    expect(row).toHaveTextContent("44.0%");
    expect(row).toHaveAttribute("aria-current", "true");
    const detail = screen.getByTestId("model-detail");
    expect(detail).toHaveTextContent("yolo11n.pt");
    const classMetrics = screen.getByTestId("class-metrics");
    expect(classMetrics).toHaveTextContent("excavator");
    expect(classMetrics).toHaveTextContent("80.0%");
    expect(classMetrics).toHaveTextContent("dump_truck");
    await waitFor(() => expect(screen.getByTestId("training-curve")).toHaveAttribute("data-points", "3"));
  });

  it("selects a model by clicking its name", async () => {
    const { api } = fakeClient(routes);
    renderWithProviders(<ModelsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/models`,
      path: "/p/:projectId/models",
    });
    fireEvent.click(await screen.findByRole("button", { name: "Select model yolo11m-coco" }));
    const detail = await screen.findByTestId("model-detail");
    expect(detail).toHaveTextContent("truck");
    expect(detail).toHaveTextContent("dump_truck");
    expect(detail).toHaveTextContent("No training artifacts (imported weights).");
  });

  it("shows the not-available note on 501 and keeps the heading", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
      { method: "GET", path: /\/models$/, status: 501, body: errorBody("not_implemented", "S3 later") },
      { method: "GET", path: /\/datasets$/, status: 501, body: errorBody("not_implemented", "S1 later") },
    ]);
    renderWithProviders(<ModelsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/models`,
      path: "/p/:projectId/models",
    });
    expect(await screen.findByRole("note")).toHaveTextContent("The model registry is not available yet");
    expect(screen.getByRole("heading", { name: "Models" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
