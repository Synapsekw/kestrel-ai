import { describe, it, expect } from "vitest";
import { screen, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { exampleProject, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { Shell } from "./Shell";

function renderShell(route: string) {
  const { api } = fakeClient([
    { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
    { method: "GET", path: /\/jobs/, body: { items: [], next_cursor: null } },
  ]);
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<Shell />}>
        <Route index element={<p>projects</p>} />
        <Route path="settings" element={<p>app settings</p>} />
        <Route path="p/:projectId/data" element={<p>data</p>} />
      </Route>
    </Routes>,
    { api, route },
  );
}

describe("Shell navigation", () => {
  it("explains the disabled project entries when no project is open", () => {
    renderShell("/");
    const nav = screen.getByRole("navigation");
    expect(within(nav).getByText("Open or create a project to use these.")).toBeInTheDocument();
    expect(within(nav).getByText("Data")).toHaveAttribute("title", "Open or create a project first");
  });

  it("reaches the app settings with no project open", () => {
    renderShell("/");
    const link = within(screen.getByRole("navigation")).getByRole("link", { name: "App settings" });
    expect(link).toHaveAttribute("href", "/settings");
  });

  it("drops the hint and names the way to the editor once a project is open", () => {
    renderShell(`/p/${PROJECT_ID}/data`);
    const nav = screen.getByRole("navigation");
    expect(within(nav).queryByText("Open or create a project to use these.")).toBeNull();
    expect(within(nav).getByRole("link", { name: "Data" })).toBeInTheDocument();
    expect(within(nav).getByText("Editor")).toHaveAttribute("title", "Open an image from Data or Review");
  });
});
