import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { RESULTS_CSV, errorBody, fakeClient } from "@/test/fixtures";
import { exampleTrainingRun, exampleTrainingRun2 } from "@/test/appSectionFixtures";
import { renderWithProviders } from "@/test/render";
import { CompareCurves } from "./CompareCurves";

describe("CompareCurves", () => {
  it("overlays one line per run with its final mAP50, and names runs without a curve", async () => {
    const third = { ...exampleTrainingRun2, id: "t3", name: "no-csv", model_id: "m-missing" };
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/models\/m-missing\/artifacts\/results_csv$/,
        status: 404,
        body: errorBody("not_found", "none"),
      },
      { method: "GET", path: /\/artifacts\/results_csv$/, body: RESULTS_CSV, raw: true },
    ]);
    renderWithProviders(<CompareCurves runs={[exampleTrainingRun, exampleTrainingRun2, third]} />, { api });
    const figure = await screen.findByRole("img", { name: /mAP50 of 3 runs/ });
    await waitFor(() => expect(figure.querySelectorAll("polyline")).toHaveLength(2));
    expect(screen.getByText("machines-v1-yolo11m-coco").closest("li")).toHaveTextContent("71.0%");
    expect(screen.getByText("no-csv").closest("li")).toHaveTextContent("no curve yet");
  });
});
