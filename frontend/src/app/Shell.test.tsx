import { describe, it, expect } from "vitest";
import { screen, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { exampleProject, exampleStats, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { Shell } from "./Shell";

function renderShell(route: string) {
  const { api } = fakeClient([
    { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
    { method: "GET", path: /\/jobs/, body: { items: [], next_cursor: null } },
    { method: "GET", path: /\/stats$/, body: { ...exampleStats, pending_review_count: 2 } },
    { method: "GET", path: /\/datasets$/, body: { items: [], next_cursor: null } },
    { method: "GET", path: /\/models$/, body: { items: [], next_cursor: null } },
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

  it("links to the Datasets screen between Review and Models", () => {
    renderShell(`/p/${PROJECT_ID}/data`);
    const nav = screen.getByRole("navigation");
    const labels = ["Data", "Editor", "Review", "Datasets", "Models", "Train", "Query", "Settings"];
    const order = labels.map((label) => within(nav).getByText(label));
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(within(nav).getByRole("link", { name: "Datasets" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/datasets`,
    );
  });

  it("shows the project's next step on project screens and nothing on the Projects screen", async () => {
    const first = renderShell(`/p/${PROJECT_ID}/data`);
    expect(await screen.findByTestId("next-step")).toHaveTextContent(
      "Next: Review the 2 proposals waiting in the queue.",
    );
    first.unmount();
    renderShell("/");
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("next-step")).toBeNull();
  });
});
