import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useAgentPanel } from "@/agent/panelStore";
import { useJobsStore } from "@/store/jobs";
import { PROJECT_ID, runningJob } from "@/test/fixtures";
import { useAddData } from "./addDataStore";
import { useProvidedRouteActions } from "./routeActions";
import { TopBar } from "./TopBar";

function renderBar(path: string, projectId?: string) {
  const onOpenPalette = vi.fn();
  render(
    <MemoryRouter initialEntries={[path]}>
      <TopBar projectId={projectId} onOpenPalette={onOpenPalette} />
    </MemoryRouter>,
  );
  return { onOpenPalette, banner: screen.getByRole("banner") };
}

describe("TopBar", () => {
  beforeEach(() => {
    useJobsStore.setState({ jobs: {} });
    useAgentPanel.setState({ open: false });
    useAddData.setState({ open: false, tile: null, projectId: PROJECT_ID });
    useProvidedRouteActions.setState({ entries: [] });
  });

  it("titles a project page by the page alone, with no breadcrumb", () => {
    const { banner } = renderBar(`/p/${PROJECT_ID}/images`, PROJECT_ID);
    expect(within(banner).getByText("Images")).toBeInTheDocument();
    expect(within(banner).queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
    expect(within(banner).queryByRole("link", { name: "Projects" })).toBeNull();
  });

  it("goes live and links the running job to the project's jobs", () => {
    useJobsStore.getState().upsert({ ...runningJob, project_id: PROJECT_ID });
    const { banner } = renderBar(`/p/${PROJECT_ID}/images`, PROJECT_ID);
    const pill = within(banner).getByRole("link", { name: /^Importing/ });
    expect(pill).toHaveAttribute("href", `/jobs?project=${PROJECT_ID}`);
  });

  it("opens the palette from the search field", () => {
    const { banner, onOpenPalette } = renderBar("/projects");
    const field = within(banner).getByRole("button", { name: "Search and commands" });
    expect(field).toHaveAttribute("aria-keyshortcuts", "Control+K");
    expect([...field.querySelectorAll("kbd")].map((k) => k.textContent)).toEqual(["Ctrl", "K"]);
    fireEvent.click(field);
    expect(onOpenPalette).toHaveBeenCalled();
  });

  it("offers Add data and Generate report on project routes", () => {
    const { banner } = renderBar(`/p/${PROJECT_ID}/maps`, PROJECT_ID);
    fireEvent.click(within(banner).getByRole("button", { name: "Add data" }));
    expect(useAddData.getState().open).toBe(true);
    expect(within(banner).getByRole("link", { name: "Generate report" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/reports`,
    );
  });

  it("shows New finding disabled on the Findings tab", () => {
    const { banner } = renderBar(`/p/${PROJECT_ID}/findings`, PROJECT_ID);
    expect(within(banner).getByRole("button", { name: "New finding" })).toBeDisabled();
  });

  it("names app sections and their pages, with no project actions", () => {
    const { banner } = renderBar("/models/datasets");
    expect(within(banner).getByText("Models · Datasets")).toBeInTheDocument();
    expect(within(banner).queryByRole("button", { name: "Add data" })).toBeNull();
  });

  it("opens the setup agent outside a project and the project agent inside one", () => {
    const { banner } = renderBar("/projects");
    const agent = within(banner).getByRole("button", { name: "Setup agent" });
    expect(agent).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(agent);
    expect(useAgentPanel.getState().open).toBe(true);
  });
});
