import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { collectDiagnostics } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { useJobsStore } from "@/store/jobs";
import { exampleOverview, exampleProject, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { Shell } from "./Shell";

function renderShell(route: string, projectStatus = 200) {
  const { api, requests } = fakeClient([
    {
      method: "GET",
      path: /\/projects\/[^/]+$/,
      status: projectStatus,
      body:
        projectStatus === 200
          ? exampleProject
          : { error: { code: "project_upgrading", message: "upgrading", details: { job_id: "j1" } } },
    },
    { method: "GET", path: /\/overview$/, body: exampleOverview },
    { method: "GET", path: /\/jobs/, body: { items: [], next_cursor: null } },
    { method: "GET", path: /\/projects$/, body: { items: [exampleProject], next_cursor: null } },
  ]);
  const view = renderWithProviders(
    <Routes>
      <Route path="/" element={<Shell />}>
        <Route path="projects" element={<p>projects page</p>} />
        <Route path="models/library" element={<p>library page</p>} />
        <Route path="p/:projectId/images" element={<input aria-label="Filter" />} />
        <Route path="p/:projectId/maps/:mapId" element={<p>map surface</p>} />
      </Route>
    </Routes>,
    { api, route },
  );
  return { ...view, requests };
}

describe("Shell", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("frames an app page with the rail and the top bar, and no project tabs", async () => {
    renderShell("/projects");
    expect(await screen.findByText("projects page")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
    expect(screen.getByRole("banner")).toHaveTextContent("Projects");
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("frames a project page with its name and the tabs", async () => {
    renderShell(`/p/${PROJECT_ID}/images`);
    const banner = screen.getByRole("banner");
    expect(await within(banner).findByRole("link", { name: exampleProject.name })).toBeInTheDocument();
    expect(within(banner).getByText("Images")).toBeInTheDocument();
    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });

  it("tells the changes store which project is open, so other projects' changes are ignored", async () => {
    renderShell(`/p/${PROJECT_ID}/images`);
    await waitFor(() => expect(useChangesStore.getState().openProjectId).toBe(PROJECT_ID));
  });

  it("hides the tabs on the full-bleed map and names the tab in the breadcrumb", async () => {
    renderShell(`/p/${PROJECT_ID}/maps/m1`);
    expect(await screen.findByText("map surface")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("banner")).toHaveTextContent("Maps");
  });

  it("still renders a project that cannot be loaded, as 'Project'", async () => {
    const { requests } = renderShell(`/p/${PROJECT_ID}/images`, 409);
    // Wait until the project load has actually been answered with 409 and handled, so the chrome
    // below is asserted after the failure, not before the request settles.
    await waitFor(() =>
      expect(requests.some((r) => r.method === "GET" && r.url.endsWith(`/projects/${PROJECT_ID}`))).toBe(
        true,
      ),
    );
    await waitFor(() => expect(collectDiagnostics()).toMatch(/load project failed: upgrading/));
    expect(within(screen.getByRole("banner")).getByRole("link", { name: "Project" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });

  it("opens the palette with Ctrl K typed into a field", async () => {
    renderShell(`/p/${PROJECT_ID}/images`);
    const field = await screen.findByLabelText("Filter");
    field.focus();
    fireEvent.keyDown(field, { key: "k", ctrlKey: true });
    await waitFor(() => expect(screen.getByRole("combobox")).toBeInTheDocument());
  });

  it("has no jobs button: the rail and the pill lead to Jobs", () => {
    renderShell("/projects");
    expect(screen.queryByRole("button", { name: /active jobs?$/ })).toBeNull();
  });
});
