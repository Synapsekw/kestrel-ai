import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { collectDiagnostics } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { useJobsStore } from "@/store/jobs";
import { exampleOverview, exampleProject, fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { Shell } from "./Shell";
import { useSidebar } from "./sidebarStore";

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}

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
        <Route path="jobs" element={<Where />} />
        <Route path="p/:projectId/images" element={<input aria-label="Filter" />} />
        <Route path="p/:projectId/maps/:mapId" element={<p>map surface</p>} />
        <Route
          path="p/:projectId/findings"
          element={
            <>
              <p>findings page</p>
              <input aria-label="Note" />
            </>
          }
        />
        <Route path="p/:projectId/maps" element={<p>map workspace</p>} />
      </Route>
    </Routes>,
    { api, route },
  );
  return { ...view, requests };
}

describe("Shell", () => {
  beforeEach(() => {
    useJobsStore.setState({ jobs: {} });
    useSidebar.setState({ stored: false, override: null });
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1280 });
  });

  it("toasts a failed library job on an app route; 'Show log' opens it in the Jobs section", async () => {
    renderShell("/models/library");
    expect(await screen.findByText("library page")).toBeInTheDocument();
    const lib = { ...runningJob, id: "j-lib", project_id: "library", type: "train" as const };
    act(() => useJobsStore.getState().upsert(lib));
    act(() => useJobsStore.getState().upsert({ ...lib, state: "failed", error: "CUDA out of memory" }));
    expect(await screen.findByText("Training failed: CUDA out of memory")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show log" }));
    expect(await screen.findByTestId("where")).toHaveTextContent("/jobs?state=failed&job=j-lib");
  });

  it("tells the changes store which project is open, so other projects' changes are ignored", async () => {
    renderShell(`/p/${PROJECT_ID}/images`);
    await waitFor(() => expect(useChangesStore.getState().openProjectId).toBe(PROJECT_ID));
  });

  it("frames an app page with the sidebar and the page title, and no tabs", async () => {
    renderShell("/projects");
    expect(await screen.findByText("projects page")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(nav).toHaveAttribute("data-state", "expanded");
    expect(within(nav).getByRole("link", { name: "Projects" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("banner")).toHaveTextContent("Projects");
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("puts the project and its pages in the sidebar, reading the overview once", async () => {
    const { requests } = renderShell(`/p/${PROJECT_ID}/images`);
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(await within(nav).findByRole("link", { name: exampleProject.name })).toBeInTheDocument();
    await within(nav).findByRole("link", { name: /^Images [\d,]+$/ });
    expect(within(nav).getByRole("link", { name: /^Images/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("banner")).toHaveTextContent("Images");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(requests.filter((r) => r.method === "GET" && r.url.endsWith("/overview"))).toHaveLength(1);
  });

  it("collapses on a full-bleed map, expands for the visit only, and collapses again on return", async () => {
    renderShell(`/p/${PROJECT_ID}/maps`);
    expect(await screen.findByText("map workspace")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(nav).toHaveAttribute("data-state", "collapsed");
    expect(screen.getByRole("banner")).toHaveTextContent("Maps");
    fireEvent.click(within(nav).getByRole("button", { name: "Expand sidebar" }));
    expect(nav).toHaveAttribute("data-state", "expanded");
    expect(useSidebar.getState().stored).toBe(false);
    fireEvent.click(within(nav).getByRole("link", { name: /^Findings/ }));
    expect(await screen.findByText("findings page")).toBeInTheDocument();
    expect(nav).toHaveAttribute("data-state", "expanded");
    fireEvent.click(within(nav).getByRole("link", { name: /^Maps/ }));
    expect(await screen.findByText("map workspace")).toBeInTheDocument();
    expect(nav).toHaveAttribute("data-state", "collapsed");
  });

  it("collapses under 1100px wide", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1000 });
    renderShell("/projects");
    expect(await screen.findByText("projects page")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toHaveAttribute(
      "data-state",
      "collapsed",
    );
  });

  it("toggles with Ctrl+B, but not while typing in a field", async () => {
    renderShell(`/p/${PROJECT_ID}/findings`);
    const field = await screen.findByLabelText("Note");
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    field.focus();
    fireEvent.keyDown(field, { key: "b", ctrlKey: true });
    expect(nav).toHaveAttribute("data-state", "expanded");
    fireEvent.keyDown(document.body, { key: "b", ctrlKey: true });
    expect(nav).toHaveAttribute("data-state", "collapsed");
    expect(useSidebar.getState().stored).toBe(true);
  });

  it("still renders a project that cannot be loaded, as 'Project'", async () => {
    const { requests } = renderShell(`/p/${PROJECT_ID}/images`, 409);
    await waitFor(() =>
      expect(requests.some((r) => r.method === "GET" && r.url.endsWith(`/projects/${PROJECT_ID}`))).toBe(
        true,
      ),
    );
    await waitFor(() => expect(collectDiagnostics()).toMatch(/load project failed: upgrading/));
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(within(nav).getByRole("link", { name: "Project" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/overview`,
    );
    expect(within(nav).getByRole("link", { name: /^Findings/ })).toBeInTheDocument();
  });

  it("opens the palette with Ctrl K typed into a field", async () => {
    renderShell(`/p/${PROJECT_ID}/images`);
    const field = await screen.findByLabelText("Filter");
    field.focus();
    fireEvent.keyDown(field, { key: "k", ctrlKey: true });
    await waitFor(() => expect(screen.getByRole("combobox")).toBeInTheDocument());
  });

  it("has no jobs button: the sidebar and the pill lead to Jobs", () => {
    renderShell("/projects");
    expect(screen.queryByRole("button", { name: /active jobs?$/ })).toBeNull();
  });
});
