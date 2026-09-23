import { beforeEach, describe, it, expect } from "vitest";
import { screen, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { exampleProject, exampleStats, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { useProgressStore } from "@/store/progress";
import { Shell } from "./Shell";

function renderShell(route: string) {
  const { api } = fakeClient([
    { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
    { method: "GET", path: /\/jobs/, body: { items: [], next_cursor: null } },
    {
      method: "GET",
      path: /\/stats$/,
      body: { ...exampleStats, image_count: 40, labeled_count: 10, pending_review_count: 2 },
    },
    { method: "GET", path: /\/datasets$/, body: { items: [], next_cursor: null } },
    { method: "GET", path: /\/models$/, body: { items: [], next_cursor: null } },
    { method: "GET", path: /\/query-runs/, body: { items: [], next_cursor: null } },
    { method: "GET", path: /\/maps$/, body: { items: [] } },
  ]);
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<Shell />}>
        <Route index element={<p>projects</p>} />
        <Route path="settings" element={<p>app settings</p>} />
        <Route path="p/:projectId" element={<p>home</p>} />
        <Route path="p/:projectId/data" element={<p>data</p>} />
      </Route>
    </Routes>,
    { api, route },
  );
}

describe("Shell navigation", () => {
  beforeEach(() => {
    useJobsStore.setState({ jobs: {}, panelOpen: false });
    useProgressStore.setState({ byProject: {} });
  });

  it("explains the missing project entries when no project is open", () => {
    renderShell("/");
    const nav = screen.getByRole("navigation");
    expect(within(nav).getByText("Open or create a project to use these.")).toBeInTheDocument();
    expect(within(nav).queryByText("Images")).toBeNull();
    expect(screen.getByRole("banner")).toHaveTextContent("Projects");
  });

  it("reaches the app settings with no project open", () => {
    renderShell("/");
    const link = within(screen.getByRole("navigation")).getByRole("link", { name: "App settings" });
    expect(link).toHaveAttribute("href", "/settings");
  });

  it("shows the project's pipeline and name once its counts are loaded", async () => {
    renderShell(`/p/${PROJECT_ID}/data`);
    const nav = screen.getByRole("navigation");
    expect(within(nav).queryByText("Open or create a project to use these.")).toBeNull();
    expect(await within(nav).findByRole("link", { name: /^Images/ })).toHaveTextContent("40");
    expect(within(nav).getByRole("link", { name: /^Label/ })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/label`,
    );
    expect(await within(nav).findByText("Ahmadia")).toBeInTheDocument();
    expect(screen.getByRole("banner")).toHaveTextContent("Images");
  });

  it("shows the project's next step on project screens and nothing on the Projects screen", async () => {
    const first = renderShell(`/p/${PROJECT_ID}/data`);
    expect(await screen.findByTestId("next-step")).toHaveTextContent("Next: Review 2 suggestions");
    first.unmount();
    renderShell("/");
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("next-step")).toBeNull();
  });

  it("keeps the banner off the project home, which carries its own next step", async () => {
    renderShell(`/p/${PROJECT_ID}`);
    expect(await screen.findByText("home")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("next-step")).toBeNull();
  });
});
