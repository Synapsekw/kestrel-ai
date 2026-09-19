import { describe, it, expect, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { exampleDataset, exampleModel, exampleStats, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { NextStepBar } from "./NextStepBar";

describe("NextStepBar", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("names the next step of the project and links to where it is done", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/stats$/,
        body: {
          ...exampleStats,
          image_count: 40,
          labeled_count: 0,
          unlabeled_count: 40,
          pending_review_count: 0,
        },
      },
      { method: "GET", path: /\/datasets$/, body: { items: [], next_cursor: null } },
      { method: "GET", path: /\/models$/, body: { items: [], next_cursor: null } },
    ]);
    renderWithProviders(<NextStepBar projectId={PROJECT_ID} />, { api });
    const link = await screen.findByRole("link", { name: /Label images: open one from the list/ });
    expect(link).toHaveAttribute("href", `/p/${PROJECT_ID}/data`);
    expect(screen.getByTestId("next-step")).toHaveTextContent(/^Next:/);
  });

  it("sends the operator to the review queue when proposals wait", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/stats$/, body: { ...exampleStats, pending_review_count: 3 } },
      { method: "GET", path: /\/datasets$/, body: { items: [exampleDataset], next_cursor: null } },
      { method: "GET", path: /\/models$/, body: { items: [exampleModel], next_cursor: null } },
    ]);
    renderWithProviders(<NextStepBar projectId={PROJECT_ID} />, { api });
    expect(
      await screen.findByRole("link", { name: "Review the 3 proposals waiting in the queue." }),
    ).toHaveAttribute("href", `/p/${PROJECT_ID}/review`);
  });

  it("renders nothing when the numbers cannot be loaded", async () => {
    const { api, requests } = fakeClient([]);
    const { container } = renderWithProviders(<NextStepBar projectId={PROJECT_ID} />, { api });
    await new Promise((r) => setTimeout(r, 50));
    expect(requests.length).toBeGreaterThan(0);
    expect(container).toBeEmptyDOMElement();
  });
});
