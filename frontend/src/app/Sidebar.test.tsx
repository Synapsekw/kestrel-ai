import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useProgressStore } from "@/store/progress";
import { Sidebar } from "./Sidebar";
import { useProjectKindStore } from "./useProjectKind";

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

describe("Sidebar", () => {
  beforeEach(() => {
    useProgressStore.setState({ byProject: {} });
    useProjectKindStore.setState({ byProject: { [PROJECT_ID]: "train" } });
  });

  it("expands the compact rail without losing routes or locked explanations", () => {
    useProgressStore.getState().set(PROJECT_ID, { ...base, images: 40 });
    const { api } = fakeClient([]);
    renderWithProviders(<Sidebar projectId={PROJECT_ID} projectName="Walkthrough" />, { api });
    const toggle = screen.getByRole("button", { name: "Expand navigation" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const links = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    act(() => screen.getByRole("link", { name: /^Train/ }).focus());
    expect(screen.getByRole("tooltip")).toHaveTextContent("Create a dataset first");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Collapse navigation" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("Walkthrough")).toBeVisible();
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(links);
    fireEvent.click(screen.getByRole("button", { name: "Collapse navigation" }));
    expect(screen.getByRole("link", { name: "Project settings" })).toBeVisible();
    expect(screen.getByRole("link", { name: "App settings" })).toBeVisible();
  });

  it("with no project open it shows Projects, Library, the hint and App settings only", () => {
    const { api } = fakeClient([]);
    renderWithProviders(<Sidebar projectId={undefined} projectName={null} />, { api });
    const nav = screen.getByRole("navigation");
    expect(within(nav).getByRole("link", { name: "Projects" })).toHaveAttribute("href", "/");
    expect(within(nav).getByRole("link", { name: "Library" })).toHaveAttribute("href", "/library");
    expect(within(nav).getByText("Open or create a project to use these.")).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "App settings" })).toHaveAttribute("href", "/settings");
    expect(within(nav).queryByText("Images")).toBeNull();
  });

  it("lists the pipeline in order with counts, ticks done steps and locks the rest with a reason", () => {
    useProgressStore.getState().set(PROJECT_ID, { ...base, images: 40, labeled: 14 });
    const { api } = fakeClient([]);
    renderWithProviders(<Sidebar projectId={PROJECT_ID} projectName="Walkthrough" />, { api });
    fireEvent.click(screen.getByRole("button", { name: "Expand navigation" }));
    const nav = screen.getByRole("navigation");
    const labels = [
      "Projects",
      "Library",
      "Home",
      "Images",
      "Label",
      "Datasets",
      "Train",
      "Review",
      "Export",
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

  it("names Review's waiting count", () => {
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
  });

  it("a training project shows the training steps: no Detect, no Maps, no Models", () => {
    useProgressStore.getState().set(PROJECT_ID, { ...base, images: 40 });
    const { api } = fakeClient([]);
    renderWithProviders(<Sidebar projectId={PROJECT_ID} projectName="Walkthrough" />, { api });
    const nav = screen.getByRole("navigation");
    for (const name of ["Images", "Label", "Datasets", "Train", "Review", "Export"]) {
      expect(within(nav).getByRole("link", { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
    expect(within(nav).queryByRole("link", { name: /^Detect/ })).toBeNull();
    expect(within(nav).queryByRole("link", { name: /^Maps/ })).toBeNull();
    expect(within(nav).queryByRole("link", { name: /^Models/ })).toBeNull();
    expect(within(nav).queryByRole("link", { name: /Past detections/ })).toBeNull();
    expect(within(nav).getByRole("link", { name: "Library" })).toHaveAttribute("href", "/library");
  });

  it("a training project with earlier detections shows Past detections above Project settings", () => {
    useProgressStore.getState().set(PROJECT_ID, { ...base, images: 40, queryRuns: 2 });
    const { api } = fakeClient([]);
    renderWithProviders(<Sidebar projectId={PROJECT_ID} projectName="Walkthrough" />, { api });
    fireEvent.click(screen.getByRole("button", { name: "Expand navigation" }));
    const nav = screen.getByRole("navigation");
    const past = within(nav).getByRole("link", { name: "Past detections" });
    expect(past).toHaveAttribute("href", `/p/${PROJECT_ID}/past`);
    const settings = within(nav).getByRole("link", { name: "Project settings" });
    expect(past.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a training project with only an earlier map also shows Past detections", () => {
    useProgressStore.getState().set(PROJECT_ID, { ...base, images: 40, maps: 1 });
    const { api } = fakeClient([]);
    renderWithProviders(<Sidebar projectId={PROJECT_ID} projectName="Walkthrough" />, { api });
    expect(screen.getByRole("link", { name: "Past detections" })).toBeInTheDocument();
  });

  it("a detection project shows Images, Detect, Maps, Review and Export, and no Label", () => {
    useProjectKindStore.getState().set(PROJECT_ID, "detect");
    useProgressStore.getState().set(PROJECT_ID, { ...base, images: 12, models: 1, queryRuns: 3, maps: 2 });
    const { api } = fakeClient([]);
    renderWithProviders(<Sidebar projectId={PROJECT_ID} projectName="North site" />, { api });
    fireEvent.click(screen.getByRole("button", { name: "Expand navigation" }));
    const nav = screen.getByRole("navigation");
    const order = ["Home", "Images", "Detect", "Maps", "Review", "Export", "Project settings"].map((label) =>
      within(nav).getByText(label),
    );
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(within(nav).getByRole("link", { name: /^Maps/ })).toHaveAttribute("href", `/p/${PROJECT_ID}/maps`);
    for (const name of ["Label", "Datasets", "Train", "Past detections", "Models"]) {
      expect(within(nav).queryByRole("link", { name: new RegExp(`^${name}`) })).toBeNull();
    }
    expect(within(nav).getByRole("link", { name: "Library" })).toBeInTheDocument();
  });

  it("a detection project with no model points Detect at the library", () => {
    useProjectKindStore.getState().set(PROJECT_ID, "detect");
    useProgressStore.getState().set(PROJECT_ID, { ...base, images: 12 });
    const { api } = fakeClient([]);
    renderWithProviders(<Sidebar projectId={PROJECT_ID} projectName="North site" />, { api });
    const detect = screen.getByRole("link", { name: /^Detect/ });
    expect(detect).toHaveAttribute("href", "/library");
    expect(detect).not.toHaveAttribute("aria-disabled");
    act(() => detect.focus());
    expect(screen.getByRole("tooltip")).toHaveTextContent("Add a model to the library first");
  });

  it("shows no steps until the project's kind is known", () => {
    useProjectKindStore.setState({ byProject: {} });
    useProgressStore.getState().set(PROJECT_ID, { ...base, images: 40 });
    const { api } = fakeClient([]);
    renderWithProviders(<Sidebar projectId={PROJECT_ID} projectName="Walkthrough" />, { api });
    const nav = screen.getByRole("navigation");
    expect(within(nav).getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: /^Images/ })).toBeNull();
  });

  it("keeps Label lit while an image is open in the editor", () => {
    useProgressStore.getState().set(PROJECT_ID, { ...base, images: 40, labeled: 14 });
    const { api } = fakeClient([]);
    renderWithProviders(<Sidebar projectId={PROJECT_ID} projectName="Walkthrough" />, {
      api,
      route: `/p/${PROJECT_ID}/edit/img-1`,
    });
    const nav = screen.getByRole("navigation");
    expect(within(nav).getByRole("link", { name: /^Label/ })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: /^Label/ }).className).toContain("bg-accent-soft");
    expect(within(nav).getByRole("link", { name: /^Images/ }).className).not.toContain("bg-accent-soft");
  });
});
