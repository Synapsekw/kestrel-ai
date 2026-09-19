import { describe, it, expect, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useProgressStore } from "@/store/progress";
import { NextStepBar } from "./NextStepBar";

const base = {
  images: 0,
  labeled: 0,
  pendingReview: 0,
  datasets: 0,
  models: 0,
  trainedModels: 0,
  queryRuns: 0,
};

describe("NextStepBar", () => {
  beforeEach(() => useProgressStore.setState({ byProject: {} }));

  it("names the next step of the project and links to where it is done", () => {
    useProgressStore.getState().set(PROJECT_ID, { ...base, images: 40 });
    const { api } = fakeClient([]);
    renderWithProviders(<NextStepBar projectId={PROJECT_ID} />, { api });
    const link = screen.getByRole("link", { name: "Label your images" });
    expect(link).toHaveAttribute("href", `/p/${PROJECT_ID}/label`);
    expect(screen.getByTestId("next-step")).toHaveTextContent(/^Next:/);
    expect(screen.getByTestId("next-step")).toHaveTextContent("0 of 40 are labeled");
  });

  it("sends the operator to the review queue when suggestions wait", () => {
    useProgressStore
      .getState()
      .set(PROJECT_ID, { ...base, images: 40, labeled: 10, datasets: 1, models: 1, pendingReview: 3 });
    const { api } = fakeClient([]);
    renderWithProviders(<NextStepBar projectId={PROJECT_ID} />, { api });
    expect(screen.getByRole("link", { name: "Review 3 suggestions" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/review`,
    );
  });

  it("renders nothing before the counts are known and when nothing is pending", () => {
    const { api } = fakeClient([]);
    const { container, rerender } = renderWithProviders(<NextStepBar projectId={PROJECT_ID} />, { api });
    expect(container).toBeEmptyDOMElement();
    useProgressStore
      .getState()
      .set(PROJECT_ID, { ...base, images: 10, labeled: 10, datasets: 1, models: 2, trainedModels: 1 });
    rerender(<NextStepBar projectId={PROJECT_ID} />);
    expect(container).toBeEmptyDOMElement();
  });
});
