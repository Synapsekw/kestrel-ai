import { beforeEach, describe, expect, it } from "vitest";
import { act, screen, within } from "@testing-library/react";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useProgressStore } from "@/store/progress";
import { Sidebar } from "./Sidebar";

const base = {
  images: 0,
  labeled: 0,
  pendingReview: 0,
  datasets: 0,
  models: 0,
  trainedModels: 0,
  queryRuns: 0,
};

describe("Sidebar", () => {
  beforeEach(() => useProgressStore.setState({ byProject: {} }));

  it("with no project open it shows Projects, the hint and App settings only", () => {
    const { api } = fakeClient([]);
    renderWithProviders(<Sidebar projectId={undefined} projectName={null} />, { api });
    const nav = screen.getByRole("navigation");
    expect(within(nav).getByRole("link", { name: "Projects" })).toHaveAttribute("href", "/");
    expect(within(nav).getByText("Open or create a project to use these.")).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "App settings" })).toHaveAttribute("href", "/settings");
    expect(within(nav).queryByText("Images")).toBeNull();
  });

  it("lists the pipeline in order with counts, ticks done steps and locks the rest with a reason", () => {
    useProgressStore.getState().set(PROJECT_ID, { ...base, images: 40, labeled: 14 });
    const { api } = fakeClient([]);
    renderWithProviders(<Sidebar projectId={PROJECT_ID} projectName="Walkthrough" />, { api });
    const nav = screen.getByRole("navigation");
    const labels = [
      "Home",
      "Images",
      "Label",
      "Datasets",
      "Train",
      "Detect",
      "Review",
      "Models",
      "Project settings",
    ];
    const order = labels.map((label) => within(nav).getByText(label));
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(within(nav).getByText("Walkthrough")).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: /^Images/ })).toHaveTextContent("40");
    expect(within(nav).getByRole("link", { name: /^Label/ })).toHaveTextContent("14 / 40");
    expect(within(nav).getByRole("link", { name: /^Datasets/ })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/datasets`,
    );
    const train = within(nav).getByRole("link", { name: /^Train/ });
    expect(train).toHaveAttribute("aria-disabled", "true");
    act(() => train.focus());
    expect(screen.getByRole("tooltip")).toHaveTextContent("Create a dataset first");
    expect(within(nav).getByRole("link", { name: /^Label/ })).not.toHaveAttribute("aria-disabled");
  });

  it("names Review's waiting count and keeps Detect reachable once a model exists", () => {
    useProgressStore.getState().set(PROJECT_ID, {
      ...base,
      images: 40,
      labeled: 14,
      datasets: 1,
      models: 1,
      pendingReview: 5,
    });
    const { api } = fakeClient([]);
    renderWithProviders(<Sidebar projectId={PROJECT_ID} projectName="Walkthrough" />, { api });
    const nav = screen.getByRole("navigation");
    expect(within(nav).getByRole("link", { name: /^Review/ })).toHaveTextContent("5");
    expect(within(nav).getByRole("link", { name: /^Detect/ })).not.toHaveAttribute("aria-disabled");
  });

  it("keeps Label lit while an image is open in the editor", () => {
    useProgressStore.getState().set(PROJECT_ID, { ...base, images: 40, labeled: 14 });
    const { api } = fakeClient([]);
    renderWithProviders(<Sidebar projectId={PROJECT_ID} projectName="Walkthrough" />, {
      api,
      route: `/p/${PROJECT_ID}/edit/img-1`,
    });
    const nav = screen.getByRole("navigation");
    expect(within(nav).getByRole("link", { name: /^Label/ }).className).toContain("bg-panel");
    expect(within(nav).getByRole("link", { name: /^Images/ }).className).not.toContain("bg-panel");
  });
});
