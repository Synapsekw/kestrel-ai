import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { createApiClient } from "@contract/client";
import {
  exampleModel,
  exampleTrainedModel,
  PROJECT_ID,
  RESULTS_CSV,
  TRAINED_MODEL_ID,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ModelArtifacts } from "./ModelArtifacts";

describe("ModelArtifacts", () => {
  it("fetches results.csv into the curve and links the PNG artifacts with the token in the query", async () => {
    const csvFetch: typeof fetch = async () =>
      new Response(RESULTS_CSV, { status: 200, headers: { "Content-Type": "text/csv" } });
    const api = createApiClient({ baseUrl: "http://fake", token: "t", fetch: csvFetch });
    renderWithProviders(<ModelArtifacts projectId={PROJECT_ID} model={exampleTrainedModel} />, { api });
    const curve = await screen.findByTestId("training-curve");
    await waitFor(() => expect(curve).toHaveAttribute("data-points", "3"));
    expect(screen.getByRole("img", { name: "Confusion matrix" })).toHaveAttribute(
      "src",
      `http://fake/api/v1/projects/${PROJECT_ID}/models/${TRAINED_MODEL_ID}/artifacts/confusion_matrix?token=t`,
    );
    expect(screen.getByRole("img", { name: "PR curve" })).toHaveAttribute(
      "src",
      `http://fake/api/v1/projects/${PROJECT_ID}/models/${TRAINED_MODEL_ID}/artifacts/pr_curve?token=t`,
    );
  });

  it("explains that imported weights have no artifacts", () => {
    const api = createApiClient({
      baseUrl: "http://fake",
      token: "t",
      fetch: async () => new Response("", { status: 404 }),
    });
    renderWithProviders(<ModelArtifacts projectId={PROJECT_ID} model={exampleModel} />, { api });
    expect(screen.getByText("No training artifacts (imported weights).")).toBeInTheDocument();
    expect(screen.queryByTestId("training-curve")).not.toBeInTheDocument();
  });
});
